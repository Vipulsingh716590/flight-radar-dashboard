import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { clampInt, MAX_REPLAY_MINUTES, StatsService } from './stats.service.js';

/**
 * History replay: the recorded traffic of the last few days, one frame per
 * poll cycle, so the map can play it back. Read-only; behind the same
 * sign-in guard as the rest of the API.
 */
@Controller('replay')
export class ReplayController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  /** First and last recorded cycle; both null while nothing has been recorded. */
  @Get('range')
  async range() {
    return this.stats.replayRange();
  }

  /**
   * Frames from `from` (ISO 8601 or epoch ms; default: `minutes` ago) for
   * `minutes` (1..180, default 60).
   */
  @Get()
  async replay(@Query('from') from?: string, @Query('minutes') minutes?: string) {
    const length = clampInt(minutes, 60, 1, MAX_REPLAY_MINUTES);
    let start: number;
    if (from === undefined || from === '') {
      start = Date.now() - length * 60_000;
    } else {
      start = /^\d+$/.test(from) ? Number(from) : Date.parse(from);
      if (!Number.isFinite(start)) throw new BadRequestException('from must be an ISO 8601 time or epoch milliseconds');
    }
    return this.stats.replay(start, length);
  }
}
