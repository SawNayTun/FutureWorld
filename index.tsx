import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './src/app.component';

// FIX: Removed ReactiveFormsModule from bootstrap providers. It is an NgModule
// and cannot be used directly as a provider. Standalone components that use
// reactive forms are already importing ReactiveFormsModule themselves.
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
  ],
}).catch((err) => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.