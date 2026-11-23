import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { curlDialogueQuotes } from '#engine/pipeline/dialogueQuotes';
import { weighViolations } from '#engine/pipeline/scene/skeletonChecks';
import { countSceneBreakLines, restoreSceneBreaks } from '#engine/pipeline/sceneBreakPlan';
import { sectionPassageNumbers, sectionPlaces, sectionSceneCoordinates } from '#engine/pipeline/sceneCoordinates';
import { splitDraftParagraphs, type ParagraphSpan } from '#engine/pipeline/beatLocations';
import {
  beatsByParagraphFromCalls,
  beatsByParagraphFromStarts,
  sectionOwnBeatNumbers,
} from '#engine/pipeline/skeletonBeats';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import {
  planSectionCount,
  planSectionTargetLengths,
  extractSectionOpening,
  SECTION_OUTPUT_LIMIT,
  splitSkeletonIntoSections,
} from '#engine/pipeline/sectionPlanning';
import {
  countRecapPhrases,
  describeThinExpansionSpots,
  findCatchphraseOveruse,
  findRunAheadDialogue,
  findThinExpansionSpots,
  trimRunAheadDialogue,
  validateExpandedSection,
  type SectionViolation,
} from '#engine/pipeline/sectionValidation';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { SceneWarning } from '#engine/pipeline/sceneGenerationTypes';
import {
  describeCatchphraseBudget,
  planSectionCatchphraseBudgets,
  type CatchphraseBudget,
} from '#engine/pipeline/catchphrases';
import {
  findBeatCoinedAddressTerms,
  planSectionWithheldAddressTerms,
} from '#engine/pipeline/addressTerms';
import {
  describeSentenceFrameBudget,
  planSectionSentenceFrameBudgets,
  type SentenceFrameBudget,
} from '#engine/pipeline/sentenceFrames';
import { scopeBackgroundFacts } from '#engine/pipeline/sectionBackgroundFacts';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  formatBackgroundFactConflict,
  resolveCraftContract,
  type Background,
  type CraftContract,
  type SceneBeat,
  type StyleDirective,
  type TraceCallTag,
} from '@storyboard/story-model';

export interface CheckedSectionText {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly keptAttempt?: number;
}

export function backgroundFactLines(background: Background): string[] {
  const header: string = [background.time, background.weather]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(', ');

  return [
    ...(header.length > 0 ? [header] : []),
    ...(background.description ?? []),
    ...(background.senses ?? []),
    ...(background.layout ?? []),
    ...(background.rules ?? []),
  ].filter((line) => line.trim().length > 0);
}

export function restoreSectionBreaks(
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'scene-breaks')) {
    return outcome;
  }

  const restored: string | undefined = restoreSceneBreaks(section, outcome.text);
  if (restored === undefined || countSceneBreakLines(restored) !== countSceneBreakLines(section)) {
    return outcome;
  }

  return {
    text: restored,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'scene-breaks'),
      {
        kind: 'scene-breaks',
        detail: `살붙임이 바꾼 장면 전환(---)을 뼈대 조각의 자리에 맞춰 되살렸습니다`,
      },
    ],
  };
}

export function sectionTargetLengths(
  styleDirective: StyleDirective | undefined,
  sections: readonly string[],
  outputLimit: number,
): number[] {
  const target: number = styleDirective?.targetWordCount ?? outputLimit * sections.length;
  return planSectionTargetLengths(sections, target, outputLimit);
}

export function trimRunAhead(
  skeleton: string,
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
  tuning: ResolvedSceneGenerationTuning,
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'runs-ahead')) {
    return outcome;
  }

  const lines: string[] = findRunAheadDialogue(skeleton, section, outcome.text, tuning);
  const trimmed: string = trimRunAheadDialogue(outcome.text, lines);
  if (trimmed === outcome.text) {
    return outcome;
  }

  return {
    text: trimmed,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'runs-ahead'),
      {
        kind: 'runs-ahead',
        detail: `다음 구간의 대사를 앞당겨 쓴 끝부분 ${(outcome.text.length - trimmed.length).toLocaleString()}자를 잘라 냈습니다`,
      },
    ],
  };
}

interface SectionExpansionRequest {
  readonly sectionNumber: number;
  readonly beatNumbers: readonly number[];
  readonly section: string;
  readonly previousSection: string | undefined;
  readonly upcomingOpening: string | undefined;
  readonly targetLength: number;
  readonly backgroundFacts: readonly string[];
  readonly sceneCoordinates: readonly string[];
  readonly sectionPlaces: readonly string[];
  readonly catchphraseBudgets: readonly CatchphraseBudget[];
  readonly sentenceFrameBudget: SentenceFrameBudget | undefined;
  readonly withheldAddressTerms: readonly string[];
}

interface SectionExpansionPlan {
  readonly sections: string[];
  readonly targetLengths: number[];
  readonly coordinatesBySection: string[][];
  readonly placesBySection: string[][];
  readonly passageNumbersBySection: number[][];
  readonly beatNumbersBySection: readonly (readonly number[])[];
  readonly scenePlaces: string[];
  readonly backgroundFacts: string[];
  readonly catchphraseBudgetsBySection: CatchphraseBudget[][];
  readonly sentenceFrameBudgetsBySection: (SentenceFrameBudget | undefined)[];
  readonly withheldAddressTermsBySection: string[][];
}

interface SectionLocation {
  readonly index: number;
  readonly beatNumbers: readonly number[];
  readonly passageNumbers: readonly number[];
}

function describeBeatRange(beatNumbers: readonly number[]): string {
  const first: number | undefined = beatNumbers[0];
  const last: number | undefined = beatNumbers.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }

  return first === last ? ` (비트 ${first})` : ` (비트 ${first}–${last})`;
}

function describeExpansionSection(sectionNumber: number, beatNumbers: readonly number[]): string {
  return `살붙임 ${sectionNumber}구간${describeBeatRange(beatNumbers)}`;
}

function findSectionOwnBeats(run: SceneGenerationRun, sections: readonly string[]): readonly (readonly number[])[] {
  const paragraphs: readonly ParagraphSpan[] = splitDraftParagraphs(run.polishedText);
  const beatCount: number = run.context.scene.card?.beats?.length ?? 0;
  const fromStarts: readonly (readonly number[])[] | undefined =
    run.skeletonBeatStarts === undefined
      ? undefined
      : beatsByParagraphFromStarts(beatCount, paragraphs, run.skeletonBeatStarts);
  const beatsByParagraph: readonly (readonly number[])[] | undefined =
    fromStarts ?? beatsByParagraphFromCalls(run.skeletonCallParagraphs, paragraphs.length);

  return sectionOwnBeatNumbers(sections, beatsByParagraph) ?? sections.map(() => []);
}

interface SectionRetryHint {
  readonly retryReasons: string[];
  readonly isUnderLengthRetry: boolean;
}

interface RejectedSectionAttempt {
  readonly attemptNumber: number;
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly weight: number;
  readonly hasSevereViolation: boolean;
  readonly isUnderLength: boolean;
  readonly thinSpots: string | undefined;
}

interface RankedSectionText extends CheckedSectionText {
  readonly hasSevereViolation: boolean;
  readonly score: number;
  readonly distance: number;
}

function isRankedBefore(candidate: RankedSectionText, best: RankedSectionText): boolean {
  if (candidate.hasSevereViolation !== best.hasSevereViolation) {
    return !candidate.hasSevereViolation;
  }
  if (candidate.score !== best.score) {
    return candidate.score < best.score;
  }

  return candidate.distance < best.distance;
}

class SectionExpansionAttempts {
  private reasons: string[] = [];
  private isUnderLengthRetry: boolean = false;
  private best: RankedSectionText;

  public constructor(
    section: string,
    private readonly targetLength: number,
    private readonly lengthDistanceWeight: number,
  ) {
    this.best = {
      text: section,
      violations: [],
      hasSevereViolation: true,
      score: Number.POSITIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
    };
  }

  public describeRetry(): SectionRetryHint {
    return { retryReasons: this.reasons, isUnderLengthRetry: this.isUnderLengthRetry };
  }

  public recordRejected(attempt: RejectedSectionAttempt): void {
    const distance: number = Math.abs(attempt.text.length - this.targetLength);
    const distanceRatio: number = this.targetLength > 0 ? distance / this.targetLength : 0;
    const lengthPenalty: number = attempt.hasSevereViolation
      ? 0
      : distanceRatio * this.lengthDistanceWeight;
    const candidate: RankedSectionText = {
      keptAttempt: attempt.attemptNumber,
      text: attempt.text,
      violations: attempt.violations,
      hasSevereViolation: attempt.hasSevereViolation,
      score: attempt.weight + lengthPenalty,
      distance,
    };
    if (isRankedBefore(candidate, this.best)) {
      this.best = candidate;
    }

    this.isUnderLengthRetry = attempt.isUnderLength;
    this.reasons = [
      ...attempt.violations.map((violation) => violation.detail),
      ...(attempt.thinSpots === undefined ? [] : [attempt.thinSpots]),
    ];
  }

  public toBestOutcome(): CheckedSectionText {
    return {
      text: this.best.text,
      violations: this.best.violations,
      ...(this.best.keptAttempt === undefined ? {} : { keptAttempt: this.best.keptAttempt }),
    };
  }
}

const retryReasonSeparator: string = ' / ';
const sectionSeparator: string = '\n\n';

function describeAttemptForTrace(
  request: SectionExpansionRequest,
  attemptNumber: number,
  retry: SectionRetryHint,
): TraceCallTag {
  return {
    expansionSectionIndex: request.sectionNumber,
    ...(request.beatNumbers.length === 0 ? {} : { beatIds: request.beatNumbers.map(String) }),
    attempt: attemptNumber,
    ...(retry.retryReasons.length === 0
      ? {}
      : { retryReason: retry.retryReasons.join(retryReasonSeparator) }),
  };
}

export class ExpandSectionStage implements ISceneStage {
  public readonly id: SceneStageId = 'expandSection';

  public async run(run: SceneGenerationRun): Promise<void> {
    const plan: SectionExpansionPlan = this.planSectionExpansion(run);
    const expandedSections: string[] = [];

    for (let index: number = 0; index < plan.sections.length; index += 1) {
      run.onProgress?.('expandSection', index + 1, plan.sections.length);

      const repaired: CheckedSectionText = await this.expandAndRepairSection(
        run,
        plan,
        index,
        expandedSections,
      );
      expandedSections.push(repaired.text);
      this.addSectionWarnings(
        run,
        {
          index,
          beatNumbers: plan.beatNumbersBySection[index] ?? [],
          passageNumbers: plan.passageNumbersBySection[index] ?? [],
        },
        repaired,
      );
      assertNotCancelled(run.shouldCancel);
    }

    run.draftBody = expandedSections.join(sectionSeparator);
    const catchphraseOveruse: readonly string[] = findCatchphraseOveruse({
      text: run.draftBody,
      characters: run.context.characters,
      beatCount: run.context.scene.card?.beats?.length ?? 0,
      tuning: run.tuning,
    });
    run.warnings.push(
      ...catchphraseOveruse.map((message): SceneWarning => ({ message, kinds: ['catchphrase'] })),
    );
  }

  private planSectionExpansion(run: SceneGenerationRun): SectionExpansionPlan {
    const outputLimit: number = run.input.sectionOutputLimit ?? SECTION_OUTPUT_LIMIT;
    const sections: string[] = splitSkeletonIntoSections(
      run.polishedText,
      planSectionCount(run.styleDirective?.targetWordCount ?? 0, outputLimit),
    );
    const targetLengths: number[] = sectionTargetLengths(run.styleDirective, sections, outputLimit);
    const beats: SceneBeat[] = run.context.scene.card?.beats ?? [];
    const coordinatesBySection: string[][] = sectionSceneCoordinates(
      run.sceneCoordinates,
      sections,
      beats,
      castNameOf(run.context),
    );
    const placesBySection: string[][] = sectionPlaces(run.sceneCoordinates, sections, beats);
    const passageNumbersBySection: number[][] = sectionPassageNumbers(sections);
    const beatNumbersBySection: readonly (readonly number[])[] = findSectionOwnBeats(run, sections);
    const scenePlaces: string[] = beats.flatMap((beat) =>
      typeof beat === 'string' || beat.place === undefined ? [] : [beat.place],
    );
    const backgroundFacts: string[] = backgroundFactLines(run.background);
    const catchphraseBudgetsBySection: CatchphraseBudget[][] = planSectionCatchphraseBudgets({
      characters: run.context.characters,
      sceneLimit: beats.length * run.tuning.catchphrasePerBeatLimit,
      sectionTargetLengths: targetLengths,
    });
    const craftContract: CraftContract = resolveCraftContract(run.styleDirective?.craftContract);
    const sentenceFrameBudgetsBySection: (SentenceFrameBudget | undefined)[] =
      planSectionSentenceFrameBudgets({
        frames: craftContract.sentenceFrames,
        framesPer10kChars: craftContract.sentenceFramesPer10kChars,
        sectionTargetLengths: targetLengths,
      });
    const withheldAddressTermsBySection: string[][] = planSectionWithheldAddressTerms({
      skeleton: run.polishedText,
      sections,
      terms: findBeatCoinedAddressTerms(beats, run.context.characters),
    });

    return {
      sections,
      targetLengths,
      coordinatesBySection,
      placesBySection,
      passageNumbersBySection,
      beatNumbersBySection,
      scenePlaces,
      backgroundFacts,
      catchphraseBudgetsBySection,
      sentenceFrameBudgetsBySection,
      withheldAddressTermsBySection,
    };
  }

  private async expandAndRepairSection(
    run: SceneGenerationRun,
    plan: SectionExpansionPlan,
    index: number,
    finishedSections: readonly string[],
  ): Promise<CheckedSectionText> {
    const section: string = plan.sections[index] as string;
    const previousSection: string | undefined = finishedSections.at(-1);
    const startOffset: number = finishedSections.reduce(
      (offset, finished) => offset + finished.length + sectionSeparator.length,
      0,
    );
    const outcome: CheckedSectionText = await this.expandSectionWithRetries(
      run,
      this.buildSectionRequest(plan, index, previousSection),
      withAttribution(
        {
          ...buildGenerateOptions(run.providers, 'sceneSectionExpansion'),
          styleDirective: run.styleDirective,
        },
        { primary: run.sceneRef },
      ),
    );

    const trimmed: CheckedSectionText = trimRunAhead(run.polishedText, section, outcome, run.tuning);
    const restored: CheckedSectionText = restoreSectionBreaks(section, trimmed);
    this.reportSectionRepair(run, index + 1, { outcome, trimmed, restored });
    const beatNumbers: readonly number[] = plan.beatNumbersBySection[index] ?? [];
    run.report({
      kind: 'section-measured',
      expansionSectionIndex: index + 1,
      ...(beatNumbers.length === 0 ? {} : { beatNumbers }),
      startOffset,
      lengths: {
        target: plan.targetLengths[index] as number,
        skeleton: section.length,
        expanded: outcome.text.length,
        final: restored.text.length,
      },
    });

    return restored;
  }

  private reportSectionRepair(
    run: SceneGenerationRun,
    sectionNumber: number,
    texts: {
      readonly outcome: CheckedSectionText;
      readonly trimmed: CheckedSectionText;
      readonly restored: CheckedSectionText;
    },
  ): void {
    const { outcome, trimmed, restored } = texts;

    if (outcome.violations.length > 0) {
      run.report({
        kind: 'output-kept-despite-violations',
        expansionSectionIndex: sectionNumber,
        ...(outcome.keptAttempt === undefined ? {} : { attempt: outcome.keptAttempt }),
        reasons: outcome.violations.map((violation) => violation.detail),
        afterText: outcome.text,
      });
    }
    if (trimmed.text !== outcome.text) {
      run.report({
        kind: 'text-trimmed',
        expansionSectionIndex: sectionNumber,
        rule: 'runs-ahead',
        beforeText: outcome.text,
        afterText: trimmed.text,
      });
    }
    if (restored.text !== trimmed.text) {
      run.report({
        kind: 'scene-breaks-restored',
        expansionSectionIndex: sectionNumber,
        rule: 'scene-breaks',
        beforeText: trimmed.text,
        afterText: restored.text,
      });
    }
  }

  private buildSectionRequest(
    plan: SectionExpansionPlan,
    index: number,
    previousSection: string | undefined,
  ): SectionExpansionRequest {
    return {
      sectionNumber: index + 1,
      beatNumbers: plan.beatNumbersBySection[index] ?? [],
      section: plan.sections[index] as string,
      previousSection,
      upcomingOpening: extractSectionOpening(plan.sections[index + 1]),
      targetLength: plan.targetLengths[index] as number,
      backgroundFacts: scopeBackgroundFacts(
        plan.backgroundFacts,
        plan.placesBySection[index] ?? [],
        plan.scenePlaces,
      ),
      sceneCoordinates: plan.coordinatesBySection[index] ?? [],
      sectionPlaces: plan.placesBySection[index] ?? [],
      catchphraseBudgets: plan.catchphraseBudgetsBySection[index] ?? [],
      sentenceFrameBudget: plan.sentenceFrameBudgetsBySection[index],
      withheldAddressTerms: plan.withheldAddressTermsBySection[index] ?? [],
    };
  }

  private addSectionWarnings(
    run: SceneGenerationRun,
    section: SectionLocation,
    repaired: CheckedSectionText,
  ): void {
    const sectionNumber: number = section.index + 1;
    const label: string = describeExpansionSection(sectionNumber, section.beatNumbers);
    const location: Pick<SceneWarning, 'sectionNumber' | 'sectionUnit' | 'passageNumbers' | 'beatNumbers'> = {
      sectionNumber,
      sectionUnit: 'expansion',
      ...(section.passageNumbers.length === 0 ? {} : { passageNumbers: section.passageNumbers }),
      ...(section.beatNumbers.length === 0 ? {} : { beatNumbers: section.beatNumbers }),
    };
    run.warnings.push(
      ...repaired.violations.map((violation) => ({
        message: `${label}: ${violation.detail}`,
        kinds: [violation.kind],
        ...location,
      })),
    );
    const recaps: number = countRecapPhrases(repaired.text);
    if (recaps > run.tuning.sectionRecapPhraseLimit) {
      run.warnings.push({
        message: `${label}: 앞 장면을 «아까 …»로 되짚는 표현이 ${recaps}회입니다 (허용 ${run.tuning.sectionRecapPhraseLimit}회). 새 반응·논평·대사로 채우는 쪽이 낫습니다`,
        ...location,
      });
    }
  }

  private async expandSectionWithRetries(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    options: GenerateTextOptions,
  ): Promise<CheckedSectionText> {
    const attempts: SectionExpansionAttempts = new SectionExpansionAttempts(
      request.section,
      request.targetLength,
      run.tuning.sectionLengthDistanceWeight,
    );

    for (let attempt: number = 0; attempt <= run.tuning.sectionRetryLimit; attempt += 1) {
      const retry: SectionRetryHint = attempts.describeRetry();
      const expanded: string = await this.requestSectionExpansion(
        run,
        request,
        { ...options, traceTag: describeAttemptForTrace(request, attempt + 1, retry) },
        retry,
      );
      const violations: SectionViolation[] = this.validateSection(run, request, expanded);

      if (violations.length === 0) {
        return { text: expanded, violations: [] };
      }

      run.report({
        kind: 'output-rejected',
        expansionSectionIndex: request.sectionNumber,
        attempt: attempt + 1,
        reasons: violations.map((violation) => violation.detail),
        afterText: expanded,
      });

      const isUnderLength: boolean = violations.some((violation) => violation.kind === 'too-short');
      attempts.recordRejected({
        attemptNumber: attempt + 1,
        text: expanded,
        violations,
        weight: weighViolations(violations, run.tuning.violationWeights),
        hasSevereViolation: violations.some(
          (violation) =>
            run.tuning.violationWeights[violation.kind] >= run.tuning.sectionSevereViolationWeight,
        ),
        isUnderLength,
        thinSpots: isUnderLength ? this.describeThinSpots(run, request, expanded) : undefined,
      });
    }

    return attempts.toBestOutcome();
  }

  private async requestSectionExpansion(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    options: GenerateTextOptions,
    retry: SectionRetryHint,
  ): Promise<string> {
    const expanded: string = await run.aiService.expandSceneSection(
      {
        skeleton: run.polishedText,
        section: request.section,
        previousSection: request.previousSection,
        upcomingOpening: request.upcomingOpening,
        targetLength: request.targetLength,
        backgroundFacts: request.backgroundFacts,
        backgroundConflicts: run.backgroundFactConflicts.map(formatBackgroundFactConflict),
        sceneCoordinates: request.sceneCoordinates,
        catchphraseLimits: request.catchphraseBudgets.map(describeCatchphraseBudget),
        ...(request.sentenceFrameBudget === undefined
          ? {}
          : { sentenceFrameLimit: describeSentenceFrameBudget(request.sentenceFrameBudget) }),
        withheldAddressTerms: request.withheldAddressTerms,
        retryReasons: retry.retryReasons,
        isUnderLengthRetry: retry.isUnderLengthRetry,
      },
      options,
    );

    return curlDialogueQuotes(expanded);
  }

  private validateSection(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    expanded: string,
  ): SectionViolation[] {
    return validateExpandedSection({
      skeleton: run.polishedText,
      section: request.section,
      expanded,
      characters: run.context.characters,
      targetLength: request.targetLength,
      ...(request.previousSection === undefined
        ? {}
        : { previousSection: request.previousSection }),
      sectionPlaces: request.sectionPlaces,
      backgroundFacts: request.backgroundFacts,
      catchphraseBudgets: request.catchphraseBudgets,
      ...(request.sentenceFrameBudget === undefined
        ? {}
        : { sentenceFrameBudget: request.sentenceFrameBudget }),
      withheldAddressTerms: request.withheldAddressTerms,
      tuning: run.tuning,
    });
  }

  private describeThinSpots(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    expanded: string,
  ): string | undefined {
    return describeThinExpansionSpots(
      findThinExpansionSpots(request.section, expanded, run.tuning.dialogueMinimumQuotedLength),
    );
  }
}
