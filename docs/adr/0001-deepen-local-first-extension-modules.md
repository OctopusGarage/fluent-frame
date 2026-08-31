# ADR 0001: Deepen Local-First Extension Modules

## Status

Accepted

## Context

FluentFrame has three effect-heavy areas:

- YouTube page UI placement and persistence in the learning pane.
- Chrome extension background/popup messaging.
- Native host queueing and generation.

Earlier code concentrated useful behavior in a few large entry modules. That made feature work possible, but it weakened locality: queue orchestration, process spawning, cache checks, title enrichment, request construction, DOM rendering, and Chrome tab commands were mixed with their callers.

## Decision

Use deep modules at stable seams:

- Keep queue orchestration behind `QueueCoordinator`.
- Keep queue execution behind `QueueRunner`.
- Keep generation dependency assembly behind `videoProcessingPipeline`.
- Keep detached worker spawning behind `queueWorkerProcess`.
- Keep queue cache/title adapters behind `queueSupport`.
- Keep background host request construction behind `backgroundRequests`.
- Keep background one-shot runtime message routing behind `backgroundNativeMessages`.
- Keep background queue context-menu registration and remembered link state behind `backgroundQueueContextMenus`.
- Keep background streaming content-port relay behind `backgroundStreaming`.
- Keep native transport behind `nativeHostClient`.
- Keep learning pane persistence behind `uiPersistence`.
- Keep learning pane layout mutation/restoration behind `uiLayoutController`.
- Keep learning subtitle result rendering and playback sync behind `uiLearningView`.
- Keep learning pane player placement behind `uiPlacement`.
- Keep personal note mutation behind `personalNotesController`.
- Keep popup queue behavior behind `popupQueue`.
- Keep popup native-host health checks and health-line rendering behind `popupHealth`.
- Keep popup active-tab behavior behind `popupTabs`.

Callers should depend on these module interfaces rather than reconstructing their implementation details.

## Consequences

This improves leverage: one implementation change applies to direct generation, queued generation, popup actions, and content UI behavior where applicable.

This improves locality: behavior that depends on Chrome, the DOM, filesystem cache, remote cache, agent runner setup, or detached processes is concentrated in the module that owns that seam.

The tradeoff is more files. Keep new files only when the deletion test says removing the module would spread complexity back across callers.
