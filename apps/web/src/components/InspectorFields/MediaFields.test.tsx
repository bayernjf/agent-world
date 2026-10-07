import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import type { Graph, GraphNode } from "@agent-world/core";
import ImageGenFields from "./ImageGenFields";
import VideoGenFields from "./VideoGenFields";
import type { FieldsProps } from "./types";

/** t mock: echo the key so assertions name the copy without pinning its wording. */
const t = ((key: string) => key) as unknown as TFunction;

const emptyGraph = { id: "g", name: "g", nodes: [], edges: [] } as unknown as Graph;

function props(node: GraphNode, updateNode: (id: string, patch: Partial<GraphNode>) => void) {
  return {
    node,
    graph: emptyGraph,
    updateNode,
    beginEdit: vi.fn(),
    commitEdit: vi.fn(),
    onOpenSettings: vi.fn(),
    textModelOptions: [],
    imageModelOptions: [{ model: "img-1", provider: "p", modality: "image" }],
    videoModelOptions: [{ model: "vid-1", provider: "p", modality: "video" }],
    audioModelOptions: [],
    t,
  } as unknown as FieldsProps;
}

const videoNode = (videoGen: Record<string, unknown>) =>
  ({ id: "v", kind: "videoGen", name: "Video", x: 0, y: 0, videoGen }) as unknown as GraphNode;

const imageNode = (imageGen: Record<string, unknown>) =>
  ({ id: "i", kind: "imageGen", name: "Image", x: 0, y: 0, imageGen }) as unknown as GraphNode;

function fieldControl(labelKey: string, role: "combobox" | "checkbox") {
  const label = screen.getByText(labelKey).closest("label")!;
  return within(label).getByRole(role);
}

describe("videoGen form reaches the modes the engine implements", () => {
  it("shows the generation mode and defaults it to text", () => {
    const updateNode = vi.fn();
    render(<VideoGenFields {...props(videoNode({ model: "vid-1", prompt: "" }), updateNode)} />);
    expect(fieldControl("nodes:inspector.videoGen.mode", "combobox")).toHaveValue("text");
  });

  it("asks for keyframe mode and stores no frame source by default", () => {
    const updateNode = vi.fn();
    render(<VideoGenFields {...props(videoNode({ model: "vid-1", mode: "text" }), updateNode)} />);
    expect(screen.queryByText("nodes:inspector.videoGen.useUpstreamImage")).toBeNull();

    fireEvent.change(fieldControl("nodes:inspector.videoGen.mode", "combobox"), {
      target: { value: "keyframe" },
    });
    // The form is controlled: it writes the patch, and the switch appears from
    // the stored mode (asserted in the next case), not from local state.
    expect(updateNode).toHaveBeenLastCalledWith("v", {
      videoGen: { model: "vid-1", mode: "keyframe", imageSource: undefined },
    });
  });

  it("shows the frame-source switch, unchecked, when the stored mode needs an image", () => {
    render(
      <VideoGenFields
        {...props(videoNode({ model: "vid-1", mode: "keyframe" }), vi.fn())}
      />,
    );
    expect(screen.getByText("nodes:inspector.videoGen.useUpstreamImage")).toBeInTheDocument();
    // Unchecked is the honest default, and the copy has to say the request is text-only.
    expect(fieldControl("nodes:inspector.videoGen.useUpstreamImage", "checkbox")).not.toBeChecked();
    expect(screen.getByText("nodes:inspector.videoGen.upstreamOffHint")).toBeInTheDocument();
  });

  it("writes imageSource=upstream and switches the hint when ticked", () => {
    const updateNode = vi.fn();
    render(
      <VideoGenFields
        {...props(videoNode({ model: "vid-1", mode: "reference", prompt: "go" }), updateNode)}
      />,
    );
    fireEvent.click(fieldControl("nodes:inspector.videoGen.useUpstreamImage", "checkbox"));
    expect(updateNode).toHaveBeenLastCalledWith("v", {
      videoGen: { model: "vid-1", mode: "reference", prompt: "go", imageSource: "upstream" },
    });
  });

  it("clears the frame source when the mode goes back to text", () => {
    const updateNode = vi.fn();
    render(
      <VideoGenFields
        {...props(
          videoNode({ model: "vid-1", mode: "keyframe", imageSource: "upstream" }),
          updateNode,
        )}
      />,
    );
    expect(screen.getByText("nodes:inspector.videoGen.upstreamOnHint")).toBeInTheDocument();

    fireEvent.change(fieldControl("nodes:inspector.videoGen.mode", "combobox"), {
      target: { value: "text" },
    });
    const patch = updateNode.mock.calls.at(-1)![1] as { videoGen: { imageSource?: string } };
    expect(patch.videoGen.imageSource).toBeUndefined();
  });
});

describe("imageGen form reaches the aspect the provider maps", () => {
  it("writes the chosen ratio", () => {
    const updateNode = vi.fn();
    render(<ImageGenFields {...props(imageNode({ model: "", n: 1 }), updateNode)} />);
    fireEvent.change(fieldControl("nodes:inspector.imageGen.aspect", "combobox"), {
      target: { value: "3:4" },
    });
    expect(updateNode).toHaveBeenLastCalledWith("i", {
      imageGen: { model: "", n: 1, aspect: "3:4" },
    });
  });

  it("only warns that size wins while a size is actually filled in", () => {
    render(<ImageGenFields {...props(imageNode({ model: "", size: "1024x1024" }), vi.fn())} />);
    expect(screen.getByText("nodes:inspector.imageGen.aspectSizeWins")).toBeInTheDocument();

    render(<ImageGenFields {...props(imageNode({ model: "" }), vi.fn())} />);
    expect(
      screen.getAllByText("nodes:inspector.imageGen.aspectSizeWins").length,
    ).toBe(1);
  });
});
