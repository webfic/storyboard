import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  GenerateAllDraftsUseCase,
  SceneRunReporter,
  UsageMeter,
  type GenerateAllDraftsCollaborators,
  type ISceneBatchRepository
} from "@storyboard/story-engine"
import { createTestHost, createTestRepositories } from "@storyboard/story-engine/testing"

const firstScene = vscode.Uri.file("/workspace/.storyboard/scene/01-opening.txt")
const secondScene = vscode.Uri.file("/workspace/.storyboard/scene/02-conflict.txt")
const thirdScene = vscode.Uri.file("/workspace/.storyboard/scene/03-resolution.txt")

function logger(): never {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never
}

function collaborators(
  generateDraftUseCase: unknown,
  reviseAfterGenerateGate: unknown = {},
  usageMeter: UsageMeter = new UsageMeter()
): GenerateAllDraftsCollaborators {
  const sceneRunReporter: SceneRunReporter = new SceneRunReporter({
    usageMeter,
    fileSystem: {} as never,
    configBridge: { getSeed: () => undefined }
  })
  return {
    generateDraftUseCase: generateDraftUseCase as never,
    reviseAfterGenerateGate: reviseAfterGenerateGate as never,
    sceneRunReporter,
    usageMeter
  }
}

function repository(projectCount: number, scenes: readonly vscode.Uri[]): ISceneBatchRepository {
  return { listStoryboardScenes: vi.fn(async () => ({ projectCount, scenes })) }
}

describe("GenerateAllDraftsUseCase", () => {
  it("reports when no Storyboard project is available", async () => {
    const generateDraftUseCase = { execute: vi.fn() }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: logger() }), createTestRepositories({ sceneBatches: repository(0, []) }), collaborators(generateDraftUseCase)).execute()

    expect(result).toEqual({ kind: "no_projects", ok: false })
    expect(generateDraftUseCase.execute).not.toHaveBeenCalled()
  })

  it("summarizes generated, cached, and failed drafts", async () => {
    const generateDraftUseCase = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ kind: "generated", ok: true, draftUri: firstScene, warnings: [{ message: "1구간: 목표 3,000자에 크게 못 미칩니다" }] })
        .mockResolvedValueOnce({ kind: "cache_hit", ok: true, draftUri: secondScene })
        .mockResolvedValueOnce({ kind: "failed", ok: false, message: "AI unavailable" })
    }
    const reviseAfterGenerateGate = { maybeRunAfterGenerate: vi.fn(async () => undefined) }
    const currentLogger = logger() as { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: currentLogger as never }), createTestRepositories({ sceneBatches: repository(1, [firstScene, secondScene, thirdScene]) }), collaborators(generateDraftUseCase, reviseAfterGenerateGate)).execute()

    expect(currentLogger.warn).toHaveBeenCalledWith(
      "01-opening.txt: 1구간: 목표 3,000자에 크게 못 미칩니다"
    )
    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 1,
        failureLabels: ["03-resolution.txt: AI unavailable"],
        failures: 1,
        generated: 1,
        sceneCount: 3,
        usage: [],
        scenes: [
          { stem: "01-opening.txt", ok: true, cached: false, usage: [], warnings: [{ message: "1구간: 목표 3,000자에 크게 못 미칩니다" }] },
          { stem: "02-conflict.txt", ok: true, cached: true, usage: [], warnings: [] },
          { stem: "03-resolution.txt", ok: false, cached: false, usage: [], warnings: [], message: "AI unavailable" }
        ]
      }
    })
    expect(reviseAfterGenerateGate.maybeRunAfterGenerate).toHaveBeenCalledWith(firstScene, {
      onWillRun: expect.any(Function),
      shouldCancel: undefined
    })
    expect(currentLogger.error).toHaveBeenCalledOnce()
  })

  it("stops after a cancelled draft generation", async () => {
    const generateDraftUseCase = {
      execute: vi.fn(async () => ({ kind: "cancelled", ok: false }))
    }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: logger() }), createTestRepositories({ sceneBatches: repository(1, [firstScene, secondScene]) }), collaborators(generateDraftUseCase)).execute()

    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 0,
        failureLabels: [],
        failures: 0,
        generated: 0,
        sceneCount: 2,
        usage: [],
        scenes: []
      }
    })
    expect(generateDraftUseCase.execute).toHaveBeenCalledOnce()
  })

  it("stops at the plan limit as a pause, not a failure, and says why", async () => {
    const generateDraftUseCase = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ kind: "cache_hit", ok: true, draftUri: firstScene })
        .mockResolvedValueOnce({ kind: "failed", ok: false, reason: "usage-limit", message: "한도에 닿았습니다." })
    }
    const currentLogger = logger() as { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: currentLogger as never }), createTestRepositories({ sceneBatches: repository(1, [firstScene, secondScene, thirdScene]) }), collaborators(generateDraftUseCase)).execute()

    expect(generateDraftUseCase.execute).toHaveBeenCalledTimes(2)
    expect(currentLogger.warn).toHaveBeenCalledWith("02-conflict.txt: 한도에 닿았습니다.")
    expect(currentLogger.error).not.toHaveBeenCalled()
    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 1,
        failureLabels: [],
        failures: 0,
        generated: 0,
        sceneCount: 3,
        pausedWithRemaining: 2,
        usage: [],
        scenes: [
          { stem: "01-opening.txt", ok: true, cached: true, usage: [], warnings: [] },
          { stem: "02-conflict.txt", ok: false, cached: false, usage: [], warnings: [], message: "한도에 닿았습니다." }
        ]
      }
    })
  })

  it("pauses between scenes and reports the scenes it did not reach", async () => {
    let isPauseRequested = false
    const generateDraftUseCase = {
      execute: vi.fn(async () => {
        isPauseRequested = true
        return { kind: "cache_hit", ok: true, draftUri: firstScene }
      })
    }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: logger() }), createTestRepositories({ sceneBatches: repository(1, [firstScene, secondScene, thirdScene]) }), collaborators(generateDraftUseCase)).execute({ shouldPause: () => isPauseRequested })

    expect(generateDraftUseCase.execute).toHaveBeenCalledOnce()
    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 1,
        failureLabels: [],
        failures: 0,
        generated: 0,
        sceneCount: 3,
        pausedWithRemaining: 2,
        usage: [],
        scenes: [{ stem: "01-opening.txt", ok: true, cached: true, usage: [], warnings: [] }]
      }
    })
  })

  it("reports each scene's calls, its trace run and its revise warning, and the batch total", async () => {
    const usageMeter: UsageMeter = new UsageMeter()
    const meteredSink = usageMeter.wrap({ record: async () => undefined })
    const recordCall = (stage: string, costUsd: number): Promise<void> =>
      meteredSink.record(vscode.Uri.file("/workspace") as never, {
        taskName: "sceneSectionExpansion",
        providerId: "claude",
        usage: { inputTokens: 10, outputTokens: 20 },
        costUsd,
        attribution: {} as never,
        stage
      })
    const generateDraftUseCase = {
      execute: vi
        .fn()
        .mockImplementationOnce(async () => {
          await recordCall("expandSection", 0.5)
          return { kind: "generated", ok: true, draftUri: firstScene, warnings: [], traceRunId: "run-1" }
        })
        .mockImplementationOnce(async () => {
          await recordCall("expandSection", 0.25)
          return { kind: "generated", ok: true, draftUri: secondScene, warnings: [] }
        })
    }
    const reviseAfterGenerateGate = {
      maybeRunAfterGenerate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ revisionCount: 0, failure: { stage: "check", kind: "failed", message: "검수가 멈췄습니다." } })
    }

    const result = await new GenerateAllDraftsUseCase(createTestHost({ logger: logger() }), createTestRepositories({ sceneBatches: repository(1, [firstScene, secondScene]) }), collaborators(generateDraftUseCase, reviseAfterGenerateGate, usageMeter)).execute()

    const callOf = (costUsd: number): object => ({
      stage: "expandSection",
      task: "sceneSectionExpansion",
      calls: 1,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      costUsd
    })
    expect(result.ok && result.summary.scenes[0]).toEqual({
      stem: "01-opening.txt",
      ok: true,
      cached: false,
      usage: [callOf(0.5)],
      warnings: [],
      traceRunId: "run-1"
    })
    expect(result.ok && result.summary.scenes[1]?.usage).toEqual([callOf(0.25)])
    expect(result.ok && result.summary.scenes[1]?.warnings).toEqual([
      { message: expect.any(String), stage: "reviseLoop" }
    ])
    expect(result.ok && result.summary.usage).toEqual([{ ...callOf(0.75), calls: 2, inputTokens: 20, outputTokens: 40 }])
  })
})
