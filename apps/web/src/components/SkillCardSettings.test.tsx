import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SkillCardSettings } from "./SkillCardSettings";
import type { UserSkillCard } from "../lib/api";

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderEditor(cards: UserSkillCard[] = []) {
  const onChange = vi.fn();
  const utils = render(<SkillCardSettings cards={cards} onChange={onChange} />);
  const openCard = (id: string) => {
    const head = document.querySelector(`[data-testid="card-${id}"] .model-card__head`) as HTMLElement;
    fireEvent.click(head);
  };
  return {
    onChange,
    openCard,
    rerenderWith: (next: UserSkillCard[]) => utils.rerender(<SkillCardSettings cards={next} onChange={onChange} />),
  };
}

describe("SkillCardSettings", () => {
  it("shows the empty hint", () => {
    renderEditor();
    expect(screen.getByText(/还没有自建技能卡/)).toBeInTheDocument();
  });

  it("creates a prompt-module card with a generated local: id and opens it", () => {
    const { onChange, rerenderWith } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText(/新技能卡名称/), { target: { value: "简洁语气" } });
    fireEvent.click(screen.getByText("添加"));
    const added = onChange.mock.calls[0][0][0] as UserSkillCard;
    expect(added.id).toBe("local:card-1");
    expect(added.kind).toBe("prompt-module");
    // Simulate the parent storing the new card; the editor opened itself.
    rerenderWith([added]);
    expect(screen.getByPlaceholderText(/会拼接进节点的系统提示/)).toBeInTheDocument();
  });

  it("can create a judge card by switching the kind", () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "judge" } });
    fireEvent.change(screen.getByPlaceholderText(/新技能卡名称/), { target: { value: "质检" } });
    fireEvent.click(screen.getByText("添加"));
    const added = onChange.mock.calls[0][0][0] as UserSkillCard;
    expect(added.kind).toBe("judge");
    expect(added).toHaveProperty("criterion", "");
  });

  it("edits a prompt module's text after expanding", () => {
    const card: UserSkillCard = { id: "local:tone", name: "语气", kind: "prompt-module", prompt: "" };
    const { onChange, openCard } = renderEditor([card]);
    openCard("local:tone");
    fireEvent.change(screen.getByPlaceholderText(/会拼接进节点的系统提示/), {
      target: { value: "写得简洁" },
    });
    const next = onChange.mock.calls[0][0][0] as UserSkillCard;
    expect(next).toMatchObject({ id: "local:tone", prompt: "写得简洁" });
  });

  it("adds and edits output-contract fields", () => {
    const card: UserSkillCard = {
      id: "local:shape",
      name: "结构",
      kind: "output-contract",
      fields: [{ name: "title", type: "string", required: true }],
    };
    const { onChange, openCard } = renderEditor([card]);
    openCard("local:shape");
    fireEvent.click(screen.getByText(/添加字段/));
    const afterAdd = onChange.mock.calls[0][0][0] as UserSkillCard;
    if (afterAdd.kind !== "output-contract") throw new Error("wrong kind");
    expect(afterAdd.fields).toHaveLength(2);
    expect(afterAdd.fields[1]).toEqual({ name: "", type: "string", required: false });

    fireEvent.change(screen.getByDisplayValue("string"), { target: { value: "number" } });
    const afterType = onChange.mock.calls.at(-1)![0][0] as UserSkillCard;
    if (afterType.kind !== "output-contract") throw new Error("wrong kind");
    expect(afterType.fields[0].type).toBe("number");
  });

  it("removes a card from its collapsed head", () => {
    const card: UserSkillCard = { id: "local:tone", name: "语气", kind: "judge", criterion: "x" };
    const { onChange } = renderEditor([card]);
    fireEvent.click(screen.getByText("删除技能卡"));
    expect(onChange.mock.calls[0][0]).toEqual([]);
  });
});
