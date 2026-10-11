import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, LoginError } from '../core/auth';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected async submit(event: Event, email: string, password: string): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    if (!email.trim() || !password) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(email.trim(), password);
      await this.router.navigate(['/']);
    } catch (error) {
      this.error.set(error instanceof LoginError ? error.message : 'Sign-in failed. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
