import { Controller, Get, Inject, Query } from '@nestjs/common';
import { clampInt, MAX_WINDOW_HOURS, StatsService } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  /** Average flights per hour, oldest first. `hours` defaults to 24 (max 168). */
  @Get('hourly')
  async hourly(@Query('hours') hours?: string) {
    const window = clampInt(hours, 24, 1, MAX_WINDOW_HOURS);
    return { hours: window, points: await this.stats.hourly(window) };
  }

  @Get('top-airports')
  async topAirports(@Query('hours') hours?: string, @Query('limit') limit?: string) {
    const window = clampInt(hours, 24, 1, MAX_WINDOW_HOURS);
    return { hours: window, airports: await this.stats.topAirports(window, clampInt(limit, 10, 1, 25)) };
  }

  @Get('airlines')
  async airlines(@Query('hours') hours?: string, @Query('limit') limit?: string) {
    const window = clampInt(hours, 24, 1, MAX_WINDOW_HOURS);
    return { hours: window, airlines: await this.stats.airlines(window, clampInt(limit, 8, 1, 15)) };
  }
}
