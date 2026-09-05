import { AudioGenConfig, GenericConfig, ImageGenConfig, TextGenConfig, VideoGenConfig, evaluateTemplate } from "@agent-world/core";
import type { Artifact, GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Generic node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function genericNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, budgetUsd, emit, inputFor, interpCtx, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const gcfg: GenericConfig = node.generic ?? { model: "agnes-2.0-flash", modality: "text", skills: [], format: "mp3", n: 1 };
  const modality = gcfg.modality ?? "text";
  // Prompts may reference upstream artifacts (`${craft}` / `${probe.status}`),
  // same contract as http url/body and notify messages — without this the
  // placeholder reaches the model verbatim (dogfood tpl-custom-model).
  const rawPrompt = gcfg.prompt?.trim()
    ? evaluateTemplate(gcfg.prompt.trim(), interpCtx(nodeId))
    : "";
  const prompt = rawPrompt || (await inputFor(node));

  if (modality === "text") {
    const textCfg: TextGenConfig = {
      model: gcfg.model,
      prompt: rawPrompt,
      skills: (gcfg.skills ?? []).map(s => typeof s === "string" ? { id: s, config: {}, enabled: true } : s),
      temperature: gcfg.temperature ?? 0.7,
      timeoutMs: gcfg.timeoutMs ?? 120000,
      inputPolicy: gcfg.inputPolicy ?? { mode: "all" },
      budgetUsd: gcfg.budgetUsd ?? null,
      retry: gcfg.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    };
    try {
      const gen = worker.runTextGen({ node, config: textCfg, attempt, input: prompt, signal: opts.signal });
      let out = "";
      let usage: Usage = zeroUsage();
      while (true) {
        const step = await gen.next();
        if (step.done) {
          out = step.value.output;
          usage = step.value.usage;
          break;
        }
        if (opts.signal?.aborted || ctx.aborted) {
          ctx.aborted = true;
          return;
        }
        const chunk = step.value;
        if (chunk.type === "text-delta") {
          out += chunk.text;
          emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
        }
      }
      // Same contract as textGen/translate: an empty completion is not a
      // product, and the generic node is often the run's only one.
      if (!out.trim()) {
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: `模型 ${gcfg.model} 返回了空内容（无正文可交付）`, errorCode: "PROVIDER_ERROR" });
        return;
      }
      // Observability parity: the text product must be inspectable in the
      // gallery like every other node kind's. setTextArtifact alone left the
      // generic node with a node.finished output but no artifact row (dogfood
      // tpl-custom-model run dd9641af: intake/craft/depot had artifacts, the
      // generic step between them had none) — same gap 8418d2e closed for gates.
      const artifact = setTextArtifact(artifacts, nodeId, out);
      emit({ type: "artifact.produced", nodeId, attempt, artifact });
      emit({ type: "node.finished", nodeId, attempt, output: out, usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, out.slice(0, 120), "text");
    } catch (err) {
      ctx.log.warn("generic node failed", { kind: "text", nodeId, error: (err as Error).message });
      // Honest failure, mirroring b6de7d9 for the dedicated media nodes: the
      // generic node is often the run's only product, so marking it done with
      // an empty output reported a successful run that produced nothing.
      // Templates that want a fallback should add an error edge.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `通用节点文本生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  if (modality === "image") {
    if (!worker.generateImage) {
      // Honest failure (same contract as the dedicated imageGen node): a
      // missing capability is not a successful no-op.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: "worker 无图片生成能力", errorCode: "VALIDATION" });
      return;
    }
    const imgCfg: ImageGenConfig = {
      model: gcfg.model,
      prompt: rawPrompt,
      size: gcfg.size,
      aspect: gcfg.aspect,
      n: gcfg.n ?? 1,
      baseUrl: gcfg.baseUrl,
      apiKey: gcfg.apiKey,
    };
    try {
      const results = await worker.generateImage({ node, config: imgCfg, input: prompt, signal: opts.signal });
      // Zero results is a failure, not an empty success (same as the dedicated
      // imageGen node): the provider does not serve this modality/model.
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `通用节点图片生成未返回任何结果（模型 ${imgCfg.model} 可能不支持该模态）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 0 } };
      const arts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-img"}-${idx + 1}.png`);
        const a: Artifact = {
          id: `${nodeId}-gimg-${idx}`,
          kind: "image",
          uri,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "通用图片"} #${idx + 1}` : node.name || "通用图片",
        };
        arts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
          tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
          costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
          units: { ...usage.units, ...res.usage.units },
        };
      }
      artifacts.set(nodeId, arts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `通用节点生成图片 ${results.length} 张`, "image");
    } catch (err) {
      ctx.log.warn("generic node failed", { kind: "image", nodeId, error: (err as Error).message });
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `通用节点图片生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  if (modality === "video") {
    if (!worker.generateVideo) {
      // Honest failure, mirroring b6de7d9 for the dedicated videoGen node.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
      return;
    }
    const vidCfg: VideoGenConfig = {
      model: gcfg.model,
      prompt: rawPrompt,
      duration: gcfg.duration,
      aspect: gcfg.aspect,
      size: gcfg.size,
      n: gcfg.n ?? 1,
      baseUrl: gcfg.baseUrl,
      apiKey: gcfg.apiKey,
    };
    try {
      const results = await worker.generateVideo({ node, config: vidCfg, input: prompt, signal: opts.signal });
      // Zero results is a failure, not an empty success (see imageGen above).
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `通用节点视频生成未返回任何结果（模型 ${vidCfg.model} 可能不支持该模态）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { videos: 0 } };
      const arts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const ext = res.mimeType.includes("mp4") ? "mp4" : res.mimeType.includes("webm") ? "webm" : "mov";
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-video"}-${idx + 1}.${ext}`);
        const a: Artifact = {
          id: `${nodeId}-gvid-${idx}`,
          kind: "video",
          uri,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "通用视频"} #${idx + 1}` : node.name || "通用视频",
        };
        arts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
          tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
          costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
          units: { ...usage.units, ...res.usage.units },
        };
      }
      artifacts.set(nodeId, arts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `通用节点生成视频 ${results.length} 段`, "video");
    } catch (err) {
      ctx.log.warn("generic node failed", { kind: "video", nodeId, error: (err as Error).message });
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `通用节点视频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  if (modality === "audio") {
    if (!worker.generateAudio) {
      // Honest failure, mirroring b6de7d9 for the dedicated audioGen node.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: "worker 无音频生成能力", errorCode: "VALIDATION" });
      return;
    }
    const audCfg: AudioGenConfig = {
      model: gcfg.model,
      prompt: rawPrompt,
      voice: gcfg.voice,
      format: gcfg.format ?? "mp3",
      speed: gcfg.speed,
      n: gcfg.n ?? 1,
      baseUrl: gcfg.baseUrl,
      apiKey: gcfg.apiKey,
    };
    try {
      const results = await worker.generateAudio({ node, config: audCfg, input: prompt, signal: opts.signal });
      // Zero results is a failure, not an empty success (see imageGen above).
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `通用节点音频生成未返回任何结果（模型 ${audCfg.model} 可能不支持该模态）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
      const arts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const ext = res.mimeType.includes("wav") ? "wav" : res.mimeType.includes("ogg") ? "ogg" : res.mimeType.includes("opus") ? "opus" : res.mimeType.includes("flac") ? "flac" : "mp3";
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-audio"}-${idx + 1}.${ext}`);
        const a: Artifact = {
          id: `${nodeId}-gaud-${idx}`,
          kind: "audio",
          uri,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "通用音频"} #${idx + 1}` : node.name || "通用音频",
        };
        arts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
          tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
          costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
          units: { ...usage.units, ...res.usage.units },
        };
      }
      artifacts.set(nodeId, arts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `通用节点生成音频 ${results.length} 段`, "audio");
    } catch (err) {
      ctx.log.warn("generic node failed", { kind: "audio", nodeId, error: (err as Error).message });
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `通用节点音频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  // An unknown modality is a configuration error, not a no-op: reporting done
  // with an empty output would let a mistyped node pass as a successful run.
  ctx.log.warn("generic node unknown modality", { nodeId, modality });
  states.set(nodeId, "failed");
  emit({
    type: "node.failed",
    nodeId,
    attempt,
    error: `通用节点模态 "${modality}" 不受支持（应为 text / image / video / audio）`,
    errorCode: "VALIDATION",
  });
  return;
}
