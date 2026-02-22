'use client';

import { Lock } from 'lucide-react';

interface PlaceholderTabProps {
  icon: string;
  title: string;
  description: string;
  phase: string;
  features?: string[];
}

export function PlaceholderTab({ icon, title, description, phase, features }: PlaceholderTabProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">{icon}</div>
        <h2 className="text-xl font-semibold text-mc-text mb-2">{title}</h2>
        <p className="text-sm text-mc-text-secondary mb-4">{description}</p>
        
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-mc-accent/10 text-mc-accent text-xs font-medium rounded-full mb-6">
          <Lock className="w-3 h-3" />
          {phase}
        </div>

        {features && features.length > 0 && (
          <div className="text-left bg-mc-bg-secondary border border-mc-border rounded-lg p-4 mt-2">
            <p className="text-xs font-semibold text-mc-text-secondary uppercase tracking-wider mb-3">
              Planned Features
            </p>
            <ul className="space-y-2">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-mc-text-secondary">
                  <span className="text-mc-text-secondary/40 mt-0.5">○</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
