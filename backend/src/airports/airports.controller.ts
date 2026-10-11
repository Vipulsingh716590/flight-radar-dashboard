import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { clampInt } from '../history/stats.service.js';
import { AirportsService } from './airports.service.js';

/** IATA (3) or ICAO (4) code: letters and digits only. */
const CODE_PATTERN = /^[A-Za-z0-9]{3,4}$/;

@Controller('airports')
export class AirportsController {
  constructor(@Inject(AirportsService) private readonly airports: AirportsService) {}

  /** Autocomplete for the board: `?search=del&limit=8`. */
  @Get()
  async search(@Query('search') search?: string, @Query('limit') limit?: string) {
    const text = typeof search === 'string' ? search.slice(0, 60) : '';
    return { airports: await this.airports.search(text, clampInt(limit, 8, 1, 20)) };
  }

  /** All airports with an IATA code, for map pins. Declared before `:code` so it wins. */
  @Get('pins')
  pins() {
    return { airports: this.airports.pins() };
  }

  /** Live arrivals/departures board for one Indian airport. */
  @Get(':code')
  async board(@Param('code') code: string) {
    if (!CODE_PATTERN.test(code)) throw new BadRequestException('code must be a 3-letter IATA or 4-letter ICAO code');
    const board = await this.airports.board(code);
    if (!board) throw new NotFoundException(`Unknown airport ${code.toUpperCase()}`);
    return board;
  }
}
