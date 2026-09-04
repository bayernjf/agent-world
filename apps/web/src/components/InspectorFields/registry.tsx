import type { NodeKind } from "@agent-world/core";
import type { ComponentType } from "react";
import type { FieldsProps } from "./types";
import SourceFields from "./SourceFields";
import TextGenFields from "./TextGenFields";
import ImageGenFields from "./ImageGenFields";
import VideoGenFields from "./VideoGenFields";
import AudioGenFields from "./AudioGenFields";
import GateFields from "./GateFields";
import ComplianceFields from "./ComplianceFields";
import PublishFields from "./PublishFields";
import FanoutFields from "./FanoutFields";
import SelectFields from "./SelectFields";
import HttpFields from "./HttpFields";
import CodeFields from "./CodeFields";
import BranchFields from "./BranchFields";
import MapFields from "./MapFields";
import LoopFields from "./LoopFields";
import ParallelFields from "./ParallelFields";
import TableFields from "./TableFields";
import DatabaseFields from "./DatabaseFields";
import FileParseFields from "./FileParseFields";
import TranslateFields from "./TranslateFields";
import OcrFields from "./OcrFields";
import ConvertFields from "./ConvertFields";
import SearchFields from "./SearchFields";
import NotifyFields from "./NotifyFields";
import VcsFields from "./VcsFields";
import HumanFields from "./HumanFields";
import SubprocessFields from "./SubprocessFields";

/**
 * Maps a node kind to its config-panel field component. Kinds without a config
 * panel (sink, generic) are absent and simply render no config fields.
 */
export const FIELD_COMPONENTS: Partial<
  Record<NodeKind, ComponentType<FieldsProps>>
> = {
  source: SourceFields,
  textGen: TextGenFields,
  imageGen: ImageGenFields,
  videoGen: VideoGenFields,
  audioGen: AudioGenFields,
  gate: GateFields,
  compliance: ComplianceFields,
  publish: PublishFields,
  fanout: FanoutFields,
  select: SelectFields,
  http: HttpFields,
  code: CodeFields,
  branch: BranchFields,
  map: MapFields,
  loop: LoopFields,
  parallel: ParallelFields,
  table: TableFields,
  database: DatabaseFields,
  fileParse: FileParseFields,
  translate: TranslateFields,
  ocr: OcrFields,
  convert: ConvertFields,
  search: SearchFields,
  notify: NotifyFields,
  vcs: VcsFields,
  human: HumanFields,
  subprocess: SubprocessFields,
};
