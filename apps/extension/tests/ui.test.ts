import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePersonalNotes, type LearningSubtitleResult } from "@fluent-frame/shared";
import { createCoachUi } from "../src/ui.js";

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: "test",
  generatedAt: "2026-07-18T00:00:00.000Z",
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
};

const usageNoteResult: LearningSubtitleResult = {
  ...result,
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "What a way to sign off.", chinese: "多么精彩的收尾。", phraseIds: ["p1"] }],
  phrases: [
    {
      id: "p1",
      cueId: 1,
      phrase: "sign off",
      meaningZh: "收尾；结束",
      explanationEn: "To finish something in a memorable way.",
      usageNotes: [
        {
          term: "sign",
          question: "Why use sign here?",
          explanation: "Here sign means to close or finish, not write a signature.",
        },
      ],
      difficulty: "useful",
    },
  ],
};

const rollingResult: LearningSubtitleResult = {
  ...result,
  subtitles: [
    { id: 1, startMs: 5000, endMs: 5800, english: "Look at this", chinese: "看看这个", phraseIds: ["p1"] },
    { id: 2, startMs: 5800, endMs: 6600, english: "lovely ball here.", chinese: "漂亮的传球。", phraseIds: ["p2"] },
    { id: 3, startMs: 9000, endMs: 9800, english: "France keeps moving.", chinese: "法国继续推进。", phraseIds: ["p3"] },
    { id: 4, startMs: 18000, endMs: 18800, english: "Spain resets.", chinese: "西班牙重新组织。", phraseIds: ["p4"] },
  ],
  phrases: [
    { id: "p1", cueId: 1, phrase: "look at this", meaningZh: "看看这个", explanationEn: "Used to draw attention.", difficulty: "basic" },
    { id: "p2", cueId: 2, phrase: "lovely ball", meaningZh: "漂亮传球", explanationEn: "A well-placed pass.", difficulty: "useful" },
    { id: "p3", cueId: 3, phrase: "keeps moving", meaningZh: "继续移动", explanationEn: "Continues without stopping.", difficulty: "basic" },
    { id: "p4", cueId: 4, phrase: "resets", meaningZh: "重新组织", explanationEn: "Starts the attack again.", difficulty: "basic" },
  ],
};

const overlappingResult: LearningSubtitleResult = {
  ...result,
  subtitles: [
    {
      id: 1,
      startMs: 0,
      endMs: 3960,
      english: "Tonight we're in for an all-action affair,",
      chinese: "今晚必将是一场激烈大战，",
      phraseIds: ["p1"],
    },
    {
      id: 2,
      startMs: 1960,
      endMs: 8120,
      english: "and may the best team win,",
      chinese: "愿更强的一方获胜，",
      phraseIds: ["p2"],
    },
    {
      id: 3,
      startMs: 3960,
      endMs: 8120,
      english: "be it Spain or France.",
      chinese: "无论是西班牙还是法国。",
      phraseIds: ["p3"],
    },
  ],
  phrases: [
    { id: "p1", cueId: 1, phrase: "all-action affair", meaningZh: "激烈比赛", explanationEn: "A match with lots of action.", difficulty: "useful" },
    { id: "p2", cueId: 2, phrase: "may the best team win", meaningZh: "愿强者胜", explanationEn: "A polite contest phrase.", difficulty: "basic" },
    { id: "p3", cueId: 3, phrase: "be it Spain or France", meaningZh: "无论西班牙还是法国", explanationEn: "Means either option is possible.", difficulty: "useful" },
  ],
};

const sparsePhraseResult: LearningSubtitleResult = {
  ...result,
  subtitles: [
    { id: 1, startMs: 0, endMs: 1000, english: "Opening line.", chinese: "开场。", phraseIds: ["p1"] },
    { id: 2, startMs: 1000, endMs: 2000, english: "A plain cue.", chinese: "普通字幕。", phraseIds: [] },
    { id: 3, startMs: 2000, endMs: 3000, english: "Another plain cue.", chinese: "另一句普通字幕。", phraseIds: [] },
    { id: 4, startMs: 3000, endMs: 4000, english: "Still plain.", chinese: "仍然普通。", phraseIds: [] },
    { id: 5, startMs: 4000, endMs: 5000, english: "Useful phrase ahead.", chinese: "有用短语来了。", phraseIds: ["p2"] },
    { id: 6, startMs: 5000, endMs: 6000, english: "Second useful phrase.", chinese: "第二个有用短语。", phraseIds: ["p3"] },
    { id: 7, startMs: 6000, endMs: 7000, english: "Third useful phrase.", chinese: "第三个有用短语。", phraseIds: ["p4"] },
  ],
  phrases: [
    { id: "p1", cueId: 1, phrase: "opening line", meaningZh: "开场白", explanationEn: "The first sentence.", difficulty: "basic" },
    { id: "p2", cueId: 5, phrase: "useful phrase", meaningZh: "有用短语", explanationEn: "A phrase worth learning.", difficulty: "useful" },
    { id: "p3", cueId: 6, phrase: "second useful phrase", meaningZh: "第二个有用短语", explanationEn: "Another phrase to study.", difficulty: "useful" },
    { id: "p4", cueId: 7, phrase: "third useful phrase", meaningZh: "第三个有用短语", explanationEn: "A later phrase to study.", difficulty: "advanced" },
  ],
};

describe("createCoachUi", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders current cue and phrase", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(result);
    ui.sync(500);
    expect(document.body.textContent).toContain("Nice pass.");
    expect(document.body.textContent).toContain("传得漂亮。");
    expect(document.body.textContent).toContain("nice pass");
  });

  it("shows three active learning events with source context and a separate learning history", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(overlappingResult);

    ui.sync(2500);

    const currentCards = Array.from(document.querySelectorAll<HTMLElement>("#ff-current-phrase .ff-current-phrase-item"));
    expect(currentCards).toHaveLength(3);
    expect(currentCards[0]?.textContent).toContain("all-action affair");
    expect(currentCards[0]?.textContent).toContain("激烈比赛");
    expect(currentCards[0]?.textContent).toContain("A match with lots of action.");
    expect(currentCards[0]?.textContent).toContain("Tonight we're in for an all-action affair,");
    expect(currentCards[1]?.textContent).toContain("may the best team win");
    expect(currentCards[1]?.textContent).toContain("愿强者胜");
    expect(currentCards[1]?.textContent).toContain("A polite contest phrase.");
    expect(currentCards[2]?.textContent).toContain("be it Spain or France");
    expect(currentCards[2]?.textContent).toContain("无论西班牙还是法国");
    expect(currentCards[2]?.textContent).toContain("Means either option is possible.");
    expect(document.body.textContent).toContain("History");

    const historyCards = Array.from(document.querySelectorAll<HTMLElement>("#ff-phrase-list .ff-phrase-item"));
    expect(historyCards).toHaveLength(3);
    expect(historyCards[0]?.textContent).toContain("all-action affair");
    expect(historyCards[0]?.textContent).toContain("激烈比赛");
    expect(historyCards[0]?.textContent).toContain("A match with lots of action.");
    expect(historyCards[2]?.textContent).toContain("be it Spain or France");
  });

  it("keeps history as summarized learning events instead of raw subtitle translations", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(sparsePhraseResult);

    const historyCards = Array.from(document.querySelectorAll<HTMLElement>("#ff-phrase-list .ff-phrase-item"));

    expect(historyCards).toHaveLength(4);
    expect(historyCards[1]?.textContent).toContain("useful phrase");
    expect(historyCards[1]?.textContent).toContain("A phrase worth learning.");
    expect(historyCards[1]?.textContent).toContain("Useful phrase ahead.");
    expect(document.getElementById("ff-phrase-list")?.textContent).not.toContain("A plain cue.");
    expect(document.getElementById("ff-phrase-list")?.textContent).not.toContain("Subtitle sentence");
  });

  it("previews the first generated subtitle as soon as a result is ready", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);

    ui.setResult(result);

    expect(document.getElementById("ff-status")?.textContent).toBe("Learning subtitles ready");
    expect(document.getElementById("ff-english")?.textContent).toBe("Nice pass.");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("传得漂亮。");
  });

  it("jumps to the phrase cue start time", () => {
    const onJumpToMs = vi.fn();
    const ui = createCoachUi(document, { onJumpToMs });
    ui.mount(document.body);
    ui.setResult(result);

    document.querySelector<HTMLButtonElement>('[data-action="jump"]')?.click();

    expect(onJumpToMs).toHaveBeenCalledWith(0);
  });

  it("copies phrase text with the injected clipboard writer", async () => {
    const writeClipboard = vi.fn<(_text: string) => Promise<void>>().mockResolvedValue(undefined);
    const ui = createCoachUi(document, { writeClipboard });
    ui.mount(document.body);
    ui.setResult(result);

    document.querySelector<HTMLButtonElement>('[data-action="copy"]')?.click();

    await vi.waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith("nice pass");
    });
  });

  it("adds a sentence and phrase description to personal notes", async () => {
    const savedNotes: unknown[] = [];
    const ui = createCoachUi(document, {
      notesStore: {
        load: vi.fn().mockResolvedValue([]),
        save: vi.fn(async (notes) => {
          savedNotes.splice(0, savedNotes.length, ...notes);
        }),
      },
    });
    ui.mount(document.body);
    ui.setResult(result);

    document.querySelector<HTMLButtonElement>('[data-action="note"]')?.click();

    await vi.waitFor(() => {
      expect(savedNotes).toHaveLength(1);
    });
    expect(savedNotes[0]).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      cueId: 1,
      sentenceEnglish: "Nice pass.",
      sentenceChinese: "传得漂亮。",
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
    });
    expect(document.getElementById("ff-notes-list")?.textContent).toContain("Nice pass.");
  });

  it("renders and saves contextual usage notes for learning events", async () => {
    const savedNotes: unknown[] = [];
    const ui = createCoachUi(document, {
      notesStore: {
        load: vi.fn().mockResolvedValue([]),
        save: vi.fn(async (notes) => {
          savedNotes.splice(0, savedNotes.length, ...notes);
        }),
      },
    });
    ui.mount(document.body);
    ui.setResult(usageNoteResult);

    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("Why use sign here?");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("not write a signature");

    document.querySelector<HTMLButtonElement>('[data-action="note"]')?.click();

    await vi.waitFor(() => {
      expect(savedNotes).toHaveLength(1);
    });
    expect(savedNotes[0]).toMatchObject({
      usageNotes: [
        {
          term: "sign",
          question: "Why use sign here?",
          explanation: "Here sign means to close or finish, not write a signature.",
        },
      ],
    });
    expect(document.getElementById("ff-notes-list")?.textContent).toContain("Why use sign here?");
  });

  it("saves notes even when an agent returns an unsafe phrase ID", async () => {
    const savedNotes: unknown[] = [];
    const unsafePhraseIdResult: LearningSubtitleResult = {
      ...result,
      subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "What a way to sign off.", chinese: "多么精彩的收尾。", phraseIds: ["what a way/sign off"] }],
      phrases: [
        {
          id: "what a way/sign off",
          cueId: 1,
          phrase: "sign off",
          meaningZh: "收尾",
          explanationEn: "To finish something.",
          difficulty: "useful",
        },
      ],
    };
    const ui = createCoachUi(document, {
      notesStore: {
        load: vi.fn().mockResolvedValue([]),
        save: vi.fn(async (notes) => {
          parsePersonalNotes(notes);
          savedNotes.splice(0, savedNotes.length, ...notes);
        }),
      },
    });
    ui.mount(document.body);
    ui.setResult(unsafePhraseIdResult);

    document.querySelector<HTMLButtonElement>('[data-action="note"]')?.click();

    await vi.waitFor(() => {
      expect(savedNotes).toHaveLength(1);
    });
    expect(savedNotes[0]).toMatchObject({
      id: "dQw4w9WgXcQ:1:what_a_way_sign_off",
      phrase: "sign off",
    });
    expect(document.getElementById("ff-status")?.textContent).toBe("Added to personal notes");
  });

  it("shows a visible error when personal notes cannot be persisted", async () => {
    const ui = createCoachUi(document, {
      notesStore: {
        load: vi.fn().mockResolvedValue([]),
        save: vi.fn(async () => {
          throw new Error("Native save failed");
        }),
      },
    });
    ui.mount(document.body);
    ui.setResult(result);

    document.querySelector<HTMLButtonElement>('[data-action="note"]')?.click();

    await vi.waitFor(() => {
      expect(document.getElementById("ff-status")?.textContent).toBe("Note not saved: Native save failed");
    });
    expect(document.getElementById("ff-root")?.dataset.error).toBe("true");
    expect(document.getElementById("ff-notes-list")?.textContent).toContain("Nice pass.");
  });

  it("loads saved personal notes for later review", async () => {
    const ui = createCoachUi(document, {
      notesStore: {
        load: vi.fn().mockResolvedValue([
          {
            id: "note-1",
            videoId: "dQw4w9WgXcQ",
            cueId: 1,
            startMs: 0,
            sentenceEnglish: "Nice pass.",
            sentenceChinese: "传得漂亮。",
            phrase: "nice pass",
            meaningZh: "传得漂亮",
            explanationEn: "A good pass.",
            savedAt: "2026-07-19T00:00:00.000Z",
          },
        ]),
        save: vi.fn(),
      },
    });
    ui.mount(document.body);

    await vi.waitFor(() => {
      expect(document.getElementById("ff-notes-list")?.textContent).toContain("Nice pass.");
    });
    expect(document.getElementById("ff-notes-list")?.textContent).toContain("A good pass.");
  });

  it("jumps from a saved personal note back to the original sentence", async () => {
    const onJumpToMs = vi.fn();
    const ui = createCoachUi(document, {
      onJumpToMs,
      notesStore: {
        load: vi.fn().mockResolvedValue([
          {
            id: "note-1",
            videoId: "dQw4w9WgXcQ",
            cueId: 1,
            startMs: 1200,
            sentenceEnglish: "Nice pass.",
            sentenceChinese: "传得漂亮。",
            phrase: "nice pass",
            meaningZh: "传得漂亮",
            explanationEn: "A good pass.",
            savedAt: "2026-07-19T00:00:00.000Z",
          },
        ]),
        save: vi.fn(),
      },
    });
    ui.mount(document.body);

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>('[data-action="note-jump"]')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('[data-action="note-jump"]')?.click();

    expect(onJumpToMs).toHaveBeenCalledWith(1200);
  });

  it("marks a phrase as known visibly", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(result);

    document.querySelector<HTMLButtonElement>('[data-action="known"]')?.click();

    const item = document.querySelector<HTMLElement>('[data-phrase-id="p1"]');
    expect(item?.dataset.known).toBe("true");
    expect(item?.textContent).toContain("Known");
  });

  it("toggles the subtitle overlay visibility", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);

    const toggle = document.querySelector<HTMLButtonElement>("#ff-toggle-overlay");
    toggle?.click();
    expect(document.getElementById("ff-root")?.dataset.overlayHidden).toBe("true");

    toggle?.click();
    expect(document.getElementById("ff-root")?.dataset.overlayHidden).toBe("false");
  });

  it("toggles the in-video Now pane and changes its text size independently", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    player.append(video);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(overlappingResult);
    ui.placeSubtitleOverlay(video);

    const videoNow = document.getElementById("ff-video-now");
    document.querySelector<HTMLButtonElement>("#ff-toggle-now")?.click();
    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-root")?.dataset.nowPaneHidden).toBe("true");
    expect(videoNow?.hidden).toBe(true);
    expect(document.querySelector("#ff-toggle-now .ff-command-meta")?.textContent).toBe("Hidden");

    document.querySelector<HTMLButtonElement>("#ff-toggle-now")?.click();
    ui.placeSubtitleOverlay(video);
    document.querySelector<HTMLButtonElement>('#ff-root [data-now-size="large"]')?.click();

    expect(videoNow?.hidden).toBe(false);
    expect(videoNow?.dataset.nowSize).toBe("large");
    expect(document.querySelector<HTMLButtonElement>('#ff-root [data-now-size="large"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches between compact panel, toolbar, and study drawer layouts", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);

    expect(document.querySelector(".ff-control-label")).toBeNull();
    expect(document.querySelector(".ff-layout-switch")?.textContent).not.toContain("View");

    document.querySelector<HTMLButtonElement>('[data-layout-option="toolbar"]')?.click();
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("toolbar");

    document.querySelector<HTMLButtonElement>('[data-layout-option="drawer"]')?.click();
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("drawer");

    document.querySelector<HTMLButtonElement>('[data-layout-option="panel"]')?.click();
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("panel");
  });

  it("keeps the full pane intact while mirroring three compact learning pairs inside the video", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    player.append(video);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(overlappingResult);

    ui.placeSubtitleOverlay(video);

    const panel = document.getElementById("ff-panel");
    const videoNow = document.getElementById("ff-video-now");
    expect(panel?.parentElement?.id).toBe("ff-root");
    expect(panel?.classList.contains("ff-panel-in-player")).toBe(false);
    expect(document.querySelectorAll("#ff-current-phrase .ff-current-phrase-item")).toHaveLength(3);
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("all-action affair");
    expect(document.getElementById("ff-phrase-list")?.textContent).toContain("may the best team win");
    expect(videoNow?.parentElement).toBe(player);
    expect(videoNow?.textContent).not.toContain("Now");
    expect(videoNow?.textContent).toContain("all-action affair");
    expect(videoNow?.textContent).toContain("激烈比赛");
    expect(videoNow?.textContent).toContain("may the best team win");
    expect(videoNow?.textContent).toContain("愿强者胜");
    expect(videoNow?.textContent).toContain("be it Spain or France");
    expect(videoNow?.textContent).toContain("无论西班牙还是法国");
    expect(videoNow?.textContent).not.toContain("Tonight we're in for an all-action affair,");
    expect(videoNow?.textContent).not.toContain("今晚必将是一场激烈大战，");
    expect(videoNow?.textContent).not.toContain("A match with lots of action.");
    expect(videoNow?.textContent).not.toContain("A polite contest phrase.");
    expect(videoNow?.querySelectorAll(".ff-video-now-item")).toHaveLength(3);
    expect(videoNow?.querySelectorAll(".ff-video-now-line")).toHaveLength(6);
    expect(videoNow?.querySelectorAll(".ff-video-now-english")).toHaveLength(3);
    expect(videoNow?.querySelectorAll(".ff-video-now-chinese")).toHaveLength(3);
    expect(videoNow?.querySelectorAll("button")).toHaveLength(0);
    expect(videoNow?.style.top).toBe("96px");
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("panel");

    document.querySelector<HTMLButtonElement>('[data-layout-option="toolbar"]')?.click();
    ui.placeSubtitleOverlay(video);
    expect(panel?.parentElement?.id).toBe("ff-root");
    expect(videoNow?.hidden).toBe(false);
    expect(videoNow?.parentElement).toBe(player);

    document.querySelector<HTMLButtonElement>('[data-layout-option="drawer"]')?.click();
    ui.placeSubtitleOverlay(video);
    expect(panel?.parentElement?.id).toBe("ff-root");
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("drawer");
  });

  it("drags the in-video Now panel without being reset by automatic placement", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    player.append(video);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(overlappingResult);
    ui.placeSubtitleOverlay(video);

    const videoNow = document.getElementById("ff-video-now");
    vi.spyOn(videoNow as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 690,
      y: 96,
      top: 96,
      left: 690,
      right: 1010,
      bottom: 216,
      width: 320,
      height: 120,
      toJSON: () => ({}),
    });

    videoNow?.dispatchEvent(new MouseEvent("mousedown", { clientX: 720, clientY: 116, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 680, clientY: 156, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ui.placeSubtitleOverlay(video);

    expect(videoNow?.style.left).toBe("650px");
    expect(videoNow?.style.top).toBe("136px");
    expect(videoNow?.style.right).toBe("auto");
    expect(videoNow?.style.bottom).toBe("auto");
    expect(document.getElementById("ff-root")?.dataset.videoNowDragged).toBe("true");
  });

  it("drags the panel to a custom browser position", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const panel = document.getElementById("ff-panel");
    const header = document.querySelector<HTMLElement>(".ff-header");
    vi.spyOn(panel as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 120,
      top: 120,
      left: 100,
      right: 436,
      bottom: 420,
      width: 336,
      height: 300,
      toJSON: () => ({}),
    });

    header?.dispatchEvent(new MouseEvent("mousedown", { clientX: 130, clientY: 150, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 180, clientY: 190, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(panel?.style.left).toBe("150px");
    expect(panel?.style.top).toBe("160px");
    expect(panel?.style.right).toBe("auto");
    expect(panel?.style.bottom).toBe("auto");
    expect(document.getElementById("ff-root")?.dataset.dragged).toBe("true");
  });

  it("drags the subtitle overlay independently from the panel", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const overlay = document.getElementById("ff-overlay");
    const card = document.querySelector<HTMLElement>(".ff-caption-card");
    vi.spyOn(overlay as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 260,
      y: 420,
      top: 420,
      left: 260,
      right: 760,
      bottom: 500,
      width: 500,
      height: 80,
      toJSON: () => ({}),
    });

    card?.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 450, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 360, clientY: 490, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(overlay?.style.left).toBe("320px");
    expect(overlay?.style.top).toBe("460px");
    expect(overlay?.style.bottom).toBe("auto");
    expect(overlay?.style.transform).toBe("none");
    expect(document.getElementById("ff-root")?.dataset.subtitleDragged).toBe("true");
  });

  it("inserts the embedded player button into YouTube controls before the CC button", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    const controls = document.createElement("div");
    const ccButton = document.createElement("button");
    const settingsButton = document.createElement("button");
    controls.className = "ytp-right-controls";
    ccButton.className = "ytp-subtitles-button";
    settingsButton.className = "ytp-settings-button";
    controls.append(ccButton, settingsButton);
    document.body.appendChild(controls);

    ui.attachPlayerButton(video);

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement).toBe(controls);
    expect(controls.children[0]).toBe(badge);
    expect(controls.children[1]).toBe(ccButton);
    expect(badge?.classList.contains("ff-in-player-controls")).toBe(true);
    expect(badge?.style.left).toBe("");
    expect(badge?.style.top).toBe("");

    badge?.click();
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("true");
    badge?.click();
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("false");
  });

  it("does not throw when YouTube nests the CC button inside controls", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    const controls = document.createElement("div");
    const wrapper = document.createElement("span");
    const ccButton = document.createElement("button");
    const settingsButton = document.createElement("button");
    controls.className = "ytp-right-controls";
    ccButton.className = "ytp-subtitles-button";
    settingsButton.className = "ytp-settings-button";
    wrapper.append(ccButton);
    controls.append(wrapper, settingsButton);
    document.body.appendChild(controls);

    expect(() => ui.attachPlayerButton(video)).not.toThrow();

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement).toBe(controls);
    expect(controls.contains(badge)).toBe(true);
  });

  it("falls back to positioning the player button over the video when YouTube controls are missing", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      top: 30,
      left: 20,
      right: 820,
      bottom: 480,
      width: 800,
      height: 450,
      toJSON: () => ({}),
    });

    ui.attachPlayerButton(video);

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement?.id).toBe("ff-root");
    expect(badge?.classList.contains("ff-in-player-controls")).toBe(false);
    expect(badge?.style.left).toBe("744px");
    expect(badge?.style.top).toBe("434px");
  });

  it("inserts the embedded player button into Shorts right controls", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    const controls = document.createElement("div");
    const firstShortsControl = document.createElement("button");
    controls.id = "right-controls";
    firstShortsControl.type = "button";
    controls.append(firstShortsControl);
    document.body.appendChild(controls);

    ui.attachPlayerButton(video);

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement).toBe(controls);
    expect(controls.children[0]).toBe(badge);
    expect(controls.children[1]).toBe(firstShortsControl);
    expect(badge?.classList.contains("ff-in-player-controls")).toBe(true);
    expect(badge?.classList.contains("ff-in-shorts-controls")).toBe(true);
  });

  it("anchors subtitles to the top of the video frame before the user drags them", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    const overlay = document.getElementById("ff-overlay");
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      top: 30,
      left: 20,
      right: 820,
      bottom: 480,
      width: 800,
      height: 450,
      toJSON: () => ({}),
    });
    vi.spyOn(overlay as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 736,
      bottom: 74,
      width: 736,
      height: 74,
      toJSON: () => ({}),
    });

    ui.placeSubtitleOverlay(video);

    expect(overlay?.style.width).toBe("736px");
    expect(overlay?.style.left).toBe("420px");
    expect(overlay?.style.top).toBe("57px");
    expect(overlay?.style.bottom).toBe("auto");
    expect(overlay?.style.transform).toBe("translateX(-50%)");
  });

  it("mounts subtitles into the YouTube player and hides native captions while learning subtitles are visible", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    const nativeCaption = document.createElement("div");
    player.className = "html5-video-player playing-mode";
    nativeCaption.className = "caption-window";
    player.append(video, nativeCaption);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);

    const overlay = document.getElementById("ff-overlay");
    expect(overlay?.parentElement).toBe(player);
    expect(overlay?.classList.contains("ff-overlay-in-player")).toBe(true);
    expect(player.classList.contains("ff-hide-native-captions")).toBe(true);
    expect(overlay?.style.top).toBe("24px");
    expect(overlay?.style.bottom).toBe("auto");
  });

  it("restores native captions when the learning subtitle overlay is hidden", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    player.append(video);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);
    document.querySelector<HTMLButtonElement>("#ff-toggle-overlay")?.click();
    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-root")?.dataset.overlayHidden).toBe("true");
    expect(document.getElementById("ff-overlay")?.hidden).toBe(true);
    expect(player.classList.contains("ff-hide-native-captions")).toBe(false);

    document.querySelector<HTMLButtonElement>("#ff-toggle-overlay")?.click();
    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-overlay")?.hidden).toBe(false);
    expect(player.classList.contains("ff-hide-native-captions")).toBe(true);
  });

  it("lowers player-mounted subtitles when YouTube controls auto-hide", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    player.className = "html5-video-player playing-mode ytp-autohide";
    player.append(video);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-overlay")?.style.top).toBe("24px");
    expect(document.getElementById("ff-overlay")?.style.bottom).toBe("auto");
  });

  it("uses Shorts subtitle placement inside the Shorts player", () => {
    const ui = createCoachUi(document);
    const shortsPlayer = document.createElement("div");
    const player = document.createElement("div");
    const video = document.createElement("video");
    shortsPlayer.id = "shorts-player";
    player.className = "html5-video-player playing-mode";
    player.append(video);
    shortsPlayer.append(player);
    document.body.appendChild(shortsPlayer);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-root")?.dataset.videoMode).toBe("shorts");
    expect(document.getElementById("ff-overlay")?.style.top).toBe("24px");
    expect(document.getElementById("ff-overlay")?.style.bottom).toBe("auto");
  });

  it("hides the subtitle bubble when playback is between source subtitle cues", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(rollingResult);

    ui.sync(7800);

    expect(document.getElementById("ff-root")?.dataset.subtitleActive).toBe("false");
    expect(document.getElementById("ff-english")?.textContent).toBe("");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("");
  });

  it("marks ad playback and clears subtitle text during ads", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    const adOverlay = document.createElement("div");
    player.className = "html5-video-player playing-mode";
    adOverlay.className = "ytp-ad-player-overlay";
    player.append(video, adOverlay);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);

    expect(document.getElementById("ff-root")?.dataset.adPlayback).toBe("true");
    expect(document.getElementById("ff-english")?.textContent).toBe("");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("");
    expect(player.classList.contains("ff-hide-native-captions")).toBe(false);
  });

  it("does not treat a hidden YouTube ad overlay as active ad playback", () => {
    const ui = createCoachUi(document);
    const player = document.createElement("div");
    const video = document.createElement("video");
    const adOverlay = document.createElement("div");
    player.className = "html5-video-player playing-mode";
    adOverlay.className = "ytp-ad-player-overlay";
    adOverlay.hidden = true;
    player.append(video, adOverlay);
    document.body.appendChild(player);
    ui.mount(document.body);
    ui.setResult(result);

    ui.placeSubtitleOverlay(video);
    ui.sync(500);

    expect(document.getElementById("ff-root")?.dataset.adPlayback).toBe("false");
    expect(document.getElementById("ff-english")?.textContent).toBe("Nice pass.");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("传得漂亮。");
    expect(player.classList.contains("ff-hide-native-captions")).toBe(true);
  });

  it("does not auto-reposition subtitles after manual subtitle dragging", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    const video = document.createElement("video");
    const overlay = document.getElementById("ff-overlay");
    const card = document.querySelector<HTMLElement>(".ff-caption-card");
    vi.spyOn(overlay as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 260,
      y: 420,
      top: 420,
      left: 260,
      right: 760,
      bottom: 500,
      width: 500,
      height: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      top: 30,
      left: 20,
      right: 820,
      bottom: 480,
      width: 800,
      height: 450,
      toJSON: () => ({}),
    });

    card?.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 450, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 360, clientY: 490, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ui.placeSubtitleOverlay(video);

    expect(overlay?.style.left).toBe("320px");
    expect(overlay?.style.top).toBe("460px");
    expect(overlay?.style.transform).toBe("none");
  });

  it("shows original subtitle cues without client-side sentence merging", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(rollingResult);

    ui.sync(5000);

    expect(document.getElementById("ff-english")?.textContent).toBe("Look at this");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("看看这个");
    expect(document.getElementById("ff-english")?.textContent).not.toContain("France keeps moving.");
    expect(document.getElementById("ff-english")?.textContent).not.toContain("Spain resets.");

    ui.sync(5900);

    expect(document.getElementById("ff-english")?.textContent).toBe("lovely ball here.");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("漂亮的传球。");
  });

  it("uses the latest started cue when YouTube source captions overlap", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(overlappingResult);

    ui.sync(2500);

    expect(document.getElementById("ff-english")?.textContent).toBe("and may the best team win,");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("愿更强的一方获胜，");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("may the best team win");
    expect(document.querySelectorAll("#ff-current-phrase .ff-current-phrase-item")).toHaveLength(3);

    ui.sync(4200);

    expect(document.getElementById("ff-english")?.textContent).toBe("be it Spain or France.");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("无论是西班牙还是法国。");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("be it Spain or France");
  });

  it("keeps the current study cards moving when nearby cues have sparse phrase IDs", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(sparsePhraseResult);

    ui.sync(1500);

    expect(document.getElementById("ff-english")?.textContent).toBe("A plain cue.");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("useful phrase");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("second useful phrase");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("third useful phrase");
    expect(document.getElementById("ff-current-phrase")?.textContent).not.toContain("opening line");
  });

  it("does not turn raw fallback subtitles into learning-event cards", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult({
      ...result,
      subtitles: [
        { id: 1, startMs: 0, endMs: 1000, english: "Fallback one.", chinese: "", phraseIds: [] },
        { id: 2, startMs: 1000, endMs: 2000, english: "Fallback two.", chinese: "", phraseIds: [] },
        { id: 3, startMs: 2000, endMs: 3000, english: "Fallback three.", chinese: "", phraseIds: [] },
      ],
      phrases: [],
    });

    ui.sync(1500);

    expect(document.getElementById("ff-english")?.textContent).toBe("Fallback two.");
    expect(document.getElementById("ff-current-phrase")?.textContent).toBe("");
    expect(document.getElementById("ff-phrase-list")?.textContent).toBe("");
  });

  it("clears the video subtitle between original source cues", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(rollingResult);

    ui.sync(7800);

    expect(document.getElementById("ff-english")?.textContent).toBe("");
    expect(document.getElementById("ff-chinese")?.textContent).toBe("");
  });

  it("highlights study phrases based on playback time without auto-scrolling", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(rollingResult);

    ui.sync(18000);

    expect(document.querySelector<HTMLElement>('[data-phrase-id="p4"]')?.dataset.active).toBe("true");
    expect(document.querySelector<HTMLElement>('[data-phrase-id="p1"]')?.dataset.active).toBe("false");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("lets current study cards jump to their sentence time", () => {
    const onJumpToMs = vi.fn();
    const ui = createCoachUi(document, { onJumpToMs });
    ui.mount(document.body);
    ui.setResult(rollingResult);
    ui.sync(5000);

    document.querySelector<HTMLButtonElement>("#ff-current-phrase [data-action='current-jump']")?.click();

    expect(onJumpToMs).toHaveBeenCalledWith(5000);
  });

  it("updates the active cue when a replacement result reuses cue IDs", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(result);
    ui.sync(500);

    ui.setResult({
      ...result,
      subtitles: [
        { id: 1, startMs: 0, endMs: 1000, english: "Sharp turn.", chinese: "转身很利落。", phraseIds: ["p2"] },
      ],
      phrases: [
        {
          id: "p2",
          cueId: 1,
          phrase: "sharp turn",
          meaningZh: "利落转身",
          explanationEn: "A quick controlled turn.",
          difficulty: "useful",
        },
      ],
    });
    ui.sync(500);

    expect(document.body.textContent).toContain("Sharp turn.");
    expect(document.body.textContent).toContain("转身很利落。");
    expect(document.body.textContent).toContain("sharp turn");
    expect(document.body.textContent).not.toContain("Nice pass.");
  });

  it("clears old subtitles and phrases when a new request starts", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult(result);
    ui.sync(500);

    ui.clearResult("Generating learning subtitles...");

    expect(document.body.textContent).toContain("Generating learning subtitles...");
    expect(document.body.textContent).not.toContain("Nice pass.");
    expect(document.body.textContent).not.toContain("nice pass");
  });

  it("renders malicious subtitle and phrase strings as text", () => {
    const ui = createCoachUi(document);
    ui.mount(document.body);
    ui.setResult({
      ...result,
      subtitles: [
        {
          id: 1,
          startMs: 0,
          endMs: 1000,
          english: "<img src=x onerror=alert(1)>",
          chinese: "<script>alert(1)</script>",
          phraseIds: ["p1"],
        },
      ],
      phrases: [
        {
          id: "p1",
          cueId: 1,
          phrase: "<strong>owned</strong>",
          meaningZh: "<img src=x>",
          explanationEn: "<script>alert(1)</script>",
          difficulty: "basic",
        },
      ],
    });
    ui.sync(500);

    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.body.textContent).toContain("<strong>owned</strong>");
    expect(document.body.querySelector("#ff-english img")).toBeNull();
    expect(document.body.querySelector("#ff-current-phrase strong")).toBeNull();
    expect(document.body.querySelector("#ff-current-phrase script")).toBeNull();
    expect(document.body.querySelector("#ff-phrase-list strong")).toBeNull();
    expect(document.body.querySelector("#ff-phrase-list img")).toBeNull();
  });
});
