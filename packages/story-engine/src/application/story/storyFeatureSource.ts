import type {
  StoryUri,
  SceneFile,
  StoryboardCard,
  StoryboardProject,
} from '@storyboard/story-model';
import { parseJsonObject } from '@storyboard/story-model';
import type { z } from 'zod';
export interface StoryFileSnapshot {
  readonly uri: StoryUri;
  readonly sha256: string;
  readonly kind?: 'file' | 'directory';
}

export interface StoryFeatureSource {
  readonly workspaceRoot: StoryUri;
  readonly project: StoryboardProject;
  readonly scenes: readonly SceneFile[];
  readonly cards: readonly StoryboardCard[];
  readonly canonText: string;
  readonly snapshots: readonly StoryFileSnapshot[];
}

export interface IStoryFeatureRepository {
  load(workspaceRoot: StoryUri): Promise<StoryFeatureSource>;
  hasCurrentSnapshots(snapshots: readonly StoryFileSnapshot[]): Promise<boolean>;
}

export type StoryFeatureSourceErrorCode =
  | 'invalid-scene'
  | 'invalid-card'
  | 'source-read-failed'
  | 'no-valid-scenes'
  | 'card-name-conflict'
  | 'unknown-scene-reference'
  | 'unknown-card-reference'
  | 'duplicate-scene-slug'
  | 'invalid-scene-filename'
  | 'unreadable-response';

export class StoryFeatureSourceError extends Error {
  public constructor(
    public readonly code: StoryFeatureSourceErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StoryFeatureSourceError';
  }
}

export function parseStoryResponse<T>(schema: z.ZodType<T>, responseText: string, taskLabel: string): T {
  const parsed: z.ZodSafeParseResult<T> = schema.safeParse(parseJsonObject(responseText));

  if (parsed.success) {
    return parsed.data;
  }

  throw new StoryFeatureSourceError(
    'unreadable-response',
    `${taskLabel} 응답을 읽지 못했습니다(${describeResponseProblem(parsed.error.issues)}). 다시 실행해 보세요.`,
    parsed.error,
  );
}

function describeResponseProblem(issues: readonly z.core.$ZodIssue[]): string {
  const firstIssue: z.core.$ZodIssue | undefined = issues[0];

  if (firstIssue === undefined || firstIssue.path.length === 0) {
    return 'JSON 객체가 없음';
  }

  const fieldPath: string = firstIssue.path.map(String).join('.');
  const isFieldMissing: boolean = firstIssue.code === 'invalid_type' && firstIssue.input === undefined;

  if (isFieldMissing) {
    return `${fieldPath} 가 없음`;
  }

  if (firstIssue.code === 'too_small') {
    return `${fieldPath} 가 비어 있음`;
  }

  return `${fieldPath} 의 모양이 다름`;
}
