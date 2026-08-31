# FluentFrame Context

FluentFrame is a local-first Chrome extension for learning English from YouTube videos. The extension injects a learning pane into YouTube pages and talks to a native host for caption download, agent generation, caching, queueing, and personal notes.

## Domain Terms

- **Learning subtitle result**: Generated bilingual subtitle data for one YouTube video and caption language, including subtitle cues and phrase explanations.
- **Learning pane**: The injected FluentFrame page UI. It includes the main pane, subtitle overlay, video-now pane, player badge, notes list, and layout controls.
- **Learning view**: The module that owns rendered learning subtitle result state, active cue/phrase windows, phrase history, and playback-time sync.
- **Layout controller**: The module that owns learning pane layout controls, persisted visibility, size, and drag position state.
- **Player badge**: The compact control that lets the user show or hide the learning pane from watch and non-watch YouTube pages.
- **Video-now pane**: The floating in-player phrase pane for the currently relevant learning events.
- **Subtitle overlay**: The in-player bilingual subtitle surface managed by the extension.
- **Personal note**: A saved phrase or subtitle sentence, persisted through the native host.
- **Queue job**: A native-host generation request for one video/language/workflow version.
- **Queue coordinator**: The module that owns queue orchestration: enqueue, cache readiness, title enrichment, stale recovery, retry, remove, and worker start decisions.
- **Queue runner**: The module that claims queued jobs and executes generation work until the queue drains.
- **Video processing pipeline**: The module that assembles agent runner, caption downloader, local cache, and remote cache before invoking subtitle generation.
- **Native host transport**: The extension-to-native messaging adapter that validates and normalizes native responses.
- **Popup queue**: The Chrome extension popup surface for queue status and queue actions.

## Architecture Vocabulary

Use `module`, `interface`, `depth`, `seam`, `adapter`, `leverage`, and `locality` when discussing architecture. Prefer deep modules that hide effectful implementation details behind small interfaces.

## Current Module Intent

- `apps/native-host/src/queueCoordinator.ts` is the queue orchestration module.
- `apps/native-host/src/queueRunner.ts` is the queue execution module.
- `apps/native-host/src/videoProcessingPipeline.ts` is the generation dependency assembly module.
- `apps/native-host/src/queueSupport.ts` contains cache readiness and title resolution adapters for queue orchestration.
- `apps/native-host/src/queueWorkerProcess.ts` contains detached queue worker process startup.
- `apps/extension/src/backgroundRequests.ts` builds native host requests for background routing.
- `apps/extension/src/nativeHostClient.ts` owns native host transport.
- `apps/extension/src/uiPersistence.ts` owns persisted learning pane layout state.
- `apps/extension/src/uiLayoutController.ts` owns learning pane layout mutation and restoration.
- `apps/extension/src/uiLearningView.ts` owns learning subtitle result rendering and playback sync.
- `apps/extension/src/uiPlacement.ts` owns player badge, subtitle overlay, and video-now pane placement.
- `apps/extension/src/personalNotesController.ts` owns personal note load/save/mutation behavior.
- `apps/extension/src/popupHealth.ts` owns popup native-host health checks and health-line rendering.
- `apps/extension/src/popupQueue.ts` owns popup queue rendering, queue actions, and pasted-URL enqueue form behavior.
- `apps/extension/src/popupTabs.ts` owns popup active-tab commands.
