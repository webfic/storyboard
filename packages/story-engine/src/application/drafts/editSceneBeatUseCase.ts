import { type SceneBeat, type SceneBeatDetail, type StoryUri } from '@storyboard/story-model';

import type { HostAdapters } from '#engine/application/engineServices';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { SceneRosterEntry } from '#engine/persistence/bundles/workspaceScenes';

export type SceneBeatField = 'cast' | 'place' | 'time' | 'break';

export const sceneBeatFields: readonly SceneBeatField[] = ['cast', 'place', 'time', 'break'];

export interface SceneBeatChanges {
  readonly text?: string;
  readonly cast?: readonly string[];
  readonly place?: string;
  readonly time?: string;
  readonly break?: boolean;
}

export interface EditSceneBeatRequest {
  readonly workspaceRoot: StoryUri;
  readonly scene: string;
  readonly beatNumber: number;
  readonly changes: SceneBeatChanges;
  readonly removedFields: readonly SceneBeatField[];
}

export type EditSceneBeatResult =
  | {
      readonly ok: true;
      readonly kind: 'edited';
      readonly stem: string;
      readonly beatNumber: number;
      readonly beat: SceneBeatDetail;
    }
  | {
      readonly ok: false;
      readonly kind: 'missing' | 'no-beat' | 'unknown-reference';
      readonly message: string;
    }
  | UseCaseFailure;

function detailOf(beat: SceneBeat): SceneBeatDetail {
  return typeof beat === 'string' ? { text: beat } : beat;
}

function applyBeatChanges(
  beat: SceneBeatDetail,
  changes: SceneBeatChanges,
  removedFields: readonly SceneBeatField[],
): SceneBeatDetail {
  const isKept = (field: SceneBeatField): boolean => !removedFields.includes(field);
  const cast: readonly string[] | undefined = changes.cast ?? beat.cast;
  const place: string | undefined = changes.place ?? beat.place;
  const time: string | undefined = changes.time ?? beat.time;
  const shouldBreak: boolean | undefined = changes.break ?? beat.break;

  return {
    text: changes.text ?? beat.text,
    ...(cast !== undefined && isKept('cast') ? { cast: [...cast] } : {}),
    ...(place !== undefined && isKept('place') ? { place } : {}),
    ...(time !== undefined && isKept('time') ? { time } : {}),
    ...(shouldBreak !== undefined && isKept('break') ? { break: shouldBreak } : {}),
  };
}

export class EditSceneBeatUseCase implements IUseCase<EditSceneBeatRequest, EditSceneBeatResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: EditSceneBeatRequest): Promise<EditSceneBeatResult> {
    return await runUseCase<EditSceneBeatResult>(this.host.logger, 'Edit scene beat failed', () =>
      this.edit(request),
    );
  }

  private async edit(request: EditSceneBeatRequest): Promise<EditSceneBeatResult> {
    const found: SceneRosterEntry | undefined = await this.host.scenes.find(request.workspaceRoot, request.scene);
    if (found === undefined) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${request.scene}` };
    }

    const beats: readonly SceneBeat[] = found.file.card.beats ?? [];
    const current: SceneBeat | undefined = beats[request.beatNumber - 1];
    if (current === undefined) {
      return {
        ok: false,
        kind: 'no-beat',
        message: `${found.file.stem} 에는 비트 ${request.beatNumber}번이 없습니다 (비트 ${beats.length}개).`,
      };
    }

    const edited: SceneBeatDetail = applyBeatChanges(detailOf(current), request.changes, request.removedFields);
    const unknown: readonly string[] = await this.host.scenes.findUnknownBeatReferences(request.workspaceRoot, edited);
    if (unknown.length > 0) {
      return {
        ok: false,
        kind: 'unknown-reference',
        message: `카드가 없는 인물·장소입니다: ${unknown.join(', ')}`,
      };
    }

    await this.host.scenes.writeBeats(
      request.workspaceRoot,
      found.file.stem,
      beats.map((beat, index) => (index === request.beatNumber - 1 ? edited : beat)),
    );
    return { ok: true, kind: 'edited', stem: found.file.stem, beatNumber: request.beatNumber, beat: edited };
  }
}
