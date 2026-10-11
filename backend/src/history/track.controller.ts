import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { clampInt, StatsService } from './stats.service.js';

/** 24-bit ICAO transponder address, six hex digits. */
const ICAO24 = /^[0-9a-f]{6}$/i;

@Controller('flights')
export class TrackController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  /**
   * Recorded positions of one aircraft, oldest first: the path drawn behind a
   * selected plane. Built from the per-cycle snapshots, so resolution is one
   * point per poll (about 75 s).
   */
  @Get(':id/track')
  async track(@Param('id') id: string, @Query('hours') hours?: string) {
    if (!ICAO24.test(id)) throw new BadRequestException('id must be a 6-digit hex ICAO24 address');
    const window = clampInt(hours, 6, 1, 24);
    return { id: id.toLowerCase(), hours: window, points: await this.stats.track(id.toLowerCase(), window) };
  }
}
