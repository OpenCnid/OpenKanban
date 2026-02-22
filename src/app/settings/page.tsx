/**
 * Settings Page
 * Configure OpenKanban paths, connections, and preferences
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Save, RotateCcw, FolderOpen, Link as LinkIcon, Zap, GitBranch, CheckCircle, XCircle } from 'lucide-react';
import { getConfig, updateConfig, resetConfig, type MissionControlConfig } from '@/lib/config';

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MissionControlConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  useEffect(() => {
    setConfig(getConfig());
    checkOpenClaw();
  }, []);

  const checkOpenClaw = async () => {
    setOpenclawStatus('checking');
    try {
      const res = await fetch('/api/openclaw/status');
      if (res.ok) {
        const data = await res.json();
        setOpenclawStatus(data.connected ? 'connected' : 'disconnected');
      } else {
        setOpenclawStatus('disconnected');
      }
    } catch {
      setOpenclawStatus('disconnected');
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      updateConfig(config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      resetConfig();
      setConfig(getConfig());
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleChange = (field: keyof MissionControlConfig, value: string) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  if (!config) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-mc-text-secondary">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-bg">
      {/* Header */}
      <div className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary transition-colors"
              title="Back"
            >
              ← Back
            </button>
            <Settings className="w-6 h-6 text-mc-accent" />
            <h1 className="text-2xl font-bold text-mc-text">
              Settings
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-mc-border rounded-lg hover:bg-mc-bg-tertiary text-mc-text-secondary flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-mc-accent text-mc-bg rounded-lg hover:bg-mc-accent/90 flex items-center gap-2 disabled:opacity-50 font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Success/Error banners */}
        {saveSuccess && (
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
            ✓ Settings saved successfully
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            ✗ {error}
          </div>
        )}

        {/* OpenClaw Connection */}
        <section className="p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-mc-accent" />
              <h2 className="text-lg font-semibold text-mc-text">OpenClaw Connection</h2>
            </div>
            <div className="flex items-center gap-2">
              {openclawStatus === 'checking' && (
                <span className="text-xs text-mc-text-secondary">Checking...</span>
              )}
              {openclawStatus === 'connected' && (
                <span className="flex items-center gap-1.5 text-xs text-mc-accent-green">
                  <CheckCircle className="w-3.5 h-3.5" /> Connected
                </span>
              )}
              {openclawStatus === 'disconnected' && (
                <span className="flex items-center gap-1.5 text-xs text-mc-accent-red">
                  <XCircle className="w-3.5 h-3.5" /> Disconnected
                </span>
              )}
              <button
                onClick={checkOpenClaw}
                className="text-xs text-mc-accent hover:underline"
              >
                Test
              </button>
            </div>
          </div>
          <p className="text-sm text-mc-text-secondary mb-4">
            OpenClaw Gateway provides agent orchestration, memory, and workflow execution.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-mc-text-secondary mb-1.5">
                Gateway URL
              </label>
              <input
                type="text"
                defaultValue={process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'}
                readOnly
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm text-mc-text-secondary font-mono"
              />
              <p className="text-[10px] text-mc-text-secondary/60 mt-1">Set via OPENCLAW_GATEWAY_URL env var</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-mc-text-secondary mb-1.5">
                Auth Token
              </label>
              <input
                type="password"
                defaultValue="••••••••"
                readOnly
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm text-mc-text-secondary font-mono"
              />
              <p className="text-[10px] text-mc-text-secondary/60 mt-1">Set via OPENCLAW_GATEWAY_TOKEN env var</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-mc-bg-tertiary rounded-lg">
            <p className="text-xs font-medium text-mc-text-secondary mb-2">Required Gateway Tools</p>
            <div className="flex gap-2">
              {['sessions_spawn', 'sessions_send', 'cron', 'memory_search', 'memory_store'].map((tool) => (
                <span key={tool} className="px-2 py-1 text-[10px] font-mono bg-mc-bg border border-mc-border rounded text-mc-text-secondary">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow Preferences */}
        <section className="p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-semibold text-mc-text">Workflow Preferences</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm text-mc-text">Auto-execute on trigger</p>
                <p className="text-xs text-mc-text-secondary">When a workflow is triggered via API, execute the first step automatically</p>
              </div>
              <div className="w-10 h-6 bg-mc-accent rounded-full relative cursor-pointer">
                <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all" />
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-mc-border">
              <div>
                <p className="text-sm text-mc-text">Semantic routing</p>
                <p className="text-xs text-mc-text-secondary">Use LLM to match natural language inputs to workflow templates</p>
              </div>
              <div className="w-10 h-6 bg-mc-accent rounded-full relative cursor-pointer">
                <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all" />
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-mc-border">
              <div>
                <p className="text-sm text-mc-text">Intelligence tracking</p>
                <p className="text-xs text-mc-text-secondary">Track workflow success rates and auto-flag underperforming templates</p>
              </div>
              <div className="w-10 h-6 bg-mc-accent rounded-full relative cursor-pointer">
                <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all" />
              </div>
            </div>
          </div>
        </section>

        {/* Workspace Paths */}
        <section className="p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-semibold text-mc-text">Workspace Paths</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-mc-text-secondary mb-1.5">
                Workspace Base Path
              </label>
              <input
                type="text"
                value={config.workspaceBasePath}
                onChange={(e) => handleChange('workspaceBasePath', e.target.value)}
                placeholder="~/Documents/Shared"
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm text-mc-text focus:border-mc-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-mc-text-secondary mb-1.5">
                Projects Path
              </label>
              <input
                type="text"
                value={config.projectsPath}
                onChange={(e) => handleChange('projectsPath', e.target.value)}
                placeholder="~/Documents/Shared/projects"
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm text-mc-text focus:border-mc-accent focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* API Configuration */}
        <section className="p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <LinkIcon className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-semibold text-mc-text">API Configuration</h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-mc-text-secondary mb-1.5">
              OpenKanban URL
            </label>
            <input
              type="text"
              value={config.missionControlUrl}
              onChange={(e) => handleChange('missionControlUrl', e.target.value)}
              placeholder="http://localhost:4000"
              className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded-lg text-sm text-mc-text focus:border-mc-accent focus:outline-none"
            />
            <p className="text-[10px] text-mc-text-secondary/60 mt-1">
              Used for webhook callbacks and external API access
            </p>
          </div>
        </section>

        {/* Environment Variables Note */}
        <section className="p-5 bg-mc-accent/5 border border-mc-accent/20 rounded-lg">
          <h3 className="text-sm font-semibold text-mc-accent mb-2">
            Environment Variables
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-mc-text-secondary font-mono">
            <span>OPENCLAW_GATEWAY_URL</span><span className="text-mc-text-secondary/50">Gateway WebSocket</span>
            <span>OPENCLAW_GATEWAY_TOKEN</span><span className="text-mc-text-secondary/50">Gateway auth token</span>
            <span>MISSION_CONTROL_URL</span><span className="text-mc-text-secondary/50">API URL override</span>
            <span>WORKSPACE_BASE_PATH</span><span className="text-mc-text-secondary/50">Base workspace dir</span>
          </div>
          <p className="text-[10px] text-mc-text-secondary/50 mt-2">
            Environment variables take precedence over UI settings.
          </p>
        </section>
      </div>
    </div>
  );
}
