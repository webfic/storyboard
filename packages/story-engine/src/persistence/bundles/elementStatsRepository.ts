import {
  bundleFileRelativePath,
  parseStatsFile,
  serializeStatsFile,
  type Stat,
} from '@storyboard/story-model';

import type { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';

export class ElementStatsRepository {
  public constructor(private readonly files: BundleFileAccess) {}

  public async read(bundlePath: string): Promise<readonly Stat[]> {
    const path: string = bundleFileRelativePath(bundlePath, 'stats');
    const text: string | undefined = await this.files.readTextIfExists(path);

    return text === undefined ? [] : parseStatsFile(text, path);
  }

  public async write(bundlePath: string, stats: readonly Stat[]): Promise<void> {
    await this.files.writeText(
      bundleFileRelativePath(bundlePath, 'stats'),
      serializeStatsFile(stats),
    );
  }
}
