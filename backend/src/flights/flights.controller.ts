import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { FlightsService } from './flights.service.js';

@Controller()
export class FlightsController {
  constructor(@Inject(FlightsService) private readonly flights: FlightsService) {}

  @Get('flights/live')
  live() {
    const { flights, updatedAt, source, partial, sources } = this.flights.snapshot;
    return { updatedAt, source, partial, sources, count: flights.length, flights };
  }

  @Get('stats/summary')
  summary() {
    const { summary, updatedAt, source, partial, sources } = this.flights.snapshot;
    return { ...summary, updatedAt, source, partial, sources };
  }

  /** Public, for load balancers; deliberately reveals nothing but liveness. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
