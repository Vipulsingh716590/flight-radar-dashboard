import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

const TITLE = 'Flight Radar India';

export const routes: Routes = [
  {
    path: 'login',
    title: `Sign in · ${TITLE}`,
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    // Signed-in frame (header, navigation, live stream) around every page below.
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: `Live map · ${TITLE}`,
        loadComponent: () => import('./pages/map-page').then((m) => m.MapPage),
      },
      {
        path: 'flights',
        title: `Flights · ${TITLE}`,
        loadComponent: () => import('./pages/flights-page').then((m) => m.FlightsPage),
      },
      {
        path: 'insights',
        title: `Insights · ${TITLE}`,
        loadComponent: () => import('./pages/insights-page').then((m) => m.InsightsPage),
      },
      {
        path: 'airports',
        title: `Airports · ${TITLE}`,
        loadComponent: () => import('./pages/airports-page').then((m) => m.AirportsPage),
      },
      {
        path: 'airports/:code',
        title: `Airport board · ${TITLE}`,
        loadComponent: () => import('./pages/airports-page').then((m) => m.AirportsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
