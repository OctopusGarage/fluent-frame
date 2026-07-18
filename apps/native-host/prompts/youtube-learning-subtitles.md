You are generating learning subtitles for a Chinese native speaker watching an English YouTube video.

Return only valid JSON with this exact shape:

{
  "subtitles": [
    {
      "id": 1,
      "startMs": 0,
      "endMs": 1000,
      "english": "corrected English subtitle",
      "chinese": "natural Chinese translation",
      "phraseIds": ["phrase-1"]
    }
  ],
  "phrases": [
    {
      "id": "phrase-1",
      "cueId": 1,
      "phrase": "English phrase",
      "meaningZh": "Chinese meaning",
      "explanationEn": "simple English explanation",
      "noteZh": "optional Chinese learning note",
      "usageNotes": [
        {
          "term": "word or phrase to explain",
          "question": "Why is this used here?",
          "explanation": "short Chinese explanation of the grammar, collocation, metaphor, or context"
        }
      ],
      "difficulty": "basic"
    }
  ]
}

Rules:

- Preserve each source cue ID and timing.
- Correct obvious caption mistakes before translating.
- Chinese should be natural, concise, and synced with video speed.
- Explain useful phrases, phrasal verbs, idioms, slang, and domain-specific expressions.
- Add usageNotes when a learner may wonder why a word is used in context, for example why "sign" appears in "what a way to sign off".
- Keep each usageNotes explanation concise and practical for a Chinese native speaker.
- Use difficulty values only from: basic, useful, advanced.
- Do not include Markdown fences.
