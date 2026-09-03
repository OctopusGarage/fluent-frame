# EnglishPilot Hook Design

## Summary

EnglishPilot is a low-disruption response hook for Codex, Claude Code, and similar coding-agent conversations. After the assistant completes the main task, the hook may append one compact `English note` that improves the user's workplace English, with emphasis on software-engineering communication.

This is not a FluentFrame video-processing feature. It belongs in the assistant or hook layer that already controls final response behavior.

## Goals

- Append practical English coaching after programming-task conversations.
- Prefer software-engineering vocabulary, examples, and sentence patterns.
- Use the user's computer-English reference files as domain vocabulary input.
- Keep the note short enough that it does not derail the main task.
- Make the feature name professional and clear.

## Name

Use **EnglishPilot** as the feature name.

Use **English note** as the final response label.

Rationale: `EnglishPilot` sounds like a quiet assistant layer, not a classroom feature. `English note` is plain and easy to recognize at the end of Codex or Claude Code responses.

## Inputs

The hook should reference these local vocabulary sources:

- `/Users/kingsonwu/programming/kingson4wu/computer-english/most-frequent-technology-english-words.txt`
- `/Users/kingsonwu/programming/kingson4wu/computer-english/MIT6.824.md`
- `/Users/kingsonwu/programming/kingson4wu/computer-english/heima.txt`
- `/Users/kingsonwu/programming/kingson4wu/computer-english/1700.txt`
- `/Users/kingsonwu/programming/kingson4wu/computer-english/600.txt`

The hook should treat these files as a vocabulary and sentence-pattern reference, not as content that must be quoted every time.

## Trigger Rules

Append an `English note` when the latest allowed user prompt contains any of these:

- Chinese fragments mixed into an English prompt.
- Awkward English phrasing.
- A common workplace-English expression that can be made more natural.
- A programming context where a software-engineering sentence pattern would be useful.

Skip the note when there is no useful improvement or when the hook has already handled the prompt before the assistant turn.

## Output Format

Use one compact note at the end of the final response:

```text
English note: "original phrase" -> "more natural English"
Why: one practical rule.
IPA: keyword /IPA/ when useful.
```

The `IPA` line is optional. The note should normally be one to three short lines.

## Style

The hook should prefer software-engineering examples and wording, such as:

- "append an English note at the end"
- "keep the behavior behind a small interface"
- "make the failure path explicit"
- "cache the result to avoid repeating the same expensive operation"
- "this change belongs at the module boundary"

The note should be direct, elegant, and practical. It should not become a long lesson unless the user asks for one.

## Architecture

The feature should live in the assistant hook/configuration layer:

- Prompt analyzer: detects whether a note is useful.
- Rewriter: turns the user's phrase into natural English.
- Domain adapter: biases examples toward software-engineering vocabulary from the local reference files.
- Renderer: appends the final `English note` block.

The hook should not modify FluentFrame subtitle generation, native-host queueing, cache behavior, or extension UI.

## Error Handling

- If vocabulary files are unavailable, the hook should continue with built-in software-engineering examples.
- If no meaningful rewrite is found, omit the note.
- If pronunciation data is unavailable, omit the `IPA` line.

## Testing

Use focused examples:

- Mixed Chinese and English prompt produces one compact note.
- Awkward programming-English prompt gets a clearer engineering sentence.
- Clean prompt does not receive noisy coaching.
- Missing vocabulary files do not break final responses.

## Approval State

The user approved the `EnglishPilot` name and hook-style direction on 2026-09-04.
