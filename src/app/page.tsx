"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Settings,
  Copy,
  Brain,
  Sparkles,
  ChevronRight,
  AlertCircle,
  TrendingUp,
  Shield,
  Activity,
  Mail,
  ExternalLink,
  Loader2,
  Menu,
  X,
  Globe,
  Wifi,
  WifiOff,
  Heart,
  Timer,
  Eye,
  ChevronDown,
} from "lucide-react";

// ─── Types ───

interface ReferralConfig {
  id: string;
  masterLink: string;
  isActive: boolean;
  autoSignup: boolean;
  signupInterval: number;
  maxSignupsPerDay: number;
}

interface SignupRecord {
  id: string;
  email: string;
  referralLink: string;
  status: string;
  verificationCode: string | null;
  verificationLink: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActivityLog {
  id: string;
  type: string;
  message: string;
  signupId: string | null;
  metadata: string | null;
  createdAt: string;
}

interface DashboardStats {
  config: ReferralConfig | null;
  totalSignups: number;
  verifiedSignups: number;
  pendingSignups: number;
  failedSignups: number;
  todaySignups: number;
}

interface WorkerSlot {
  id: number;
  status: 'idle' | 'running' | 'paused' | 'stopping';
  currentEmail: string;
  currentStep: string;
  currentProxy: string;
  startedAt: string | null;
  attempts: number;
  successes: number;
  failures: number;
}

interface ProxyStatus {
  poolSize: number;
  currentIndex: number;
  lastRefresh: string;
  isRefreshing: boolean;
}

interface KeepAliveStatus {
  isRunning: boolean;
  baseUrl: string;
  startedAt: string | null;
  lastPingAt: string | null;
  lastPingStatus: 'success' | 'failure' | null;
  totalPings: number;
  successfulPings: number;
  failedPings: number;
  successRate: string;
  consecutiveFailures: number;
  uptime: string;
}

// ─── Helpers ───

function cloneIcon(icon: React.ReactNode, className: string): React.ReactNode {
  if (React.isValidElement(icon) && icon.props) {
    return React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { className });
  }
  return icon;
}

const statusConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  verified:          { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  email_created:     { color: "text-blue-400",    bg: "bg-blue-500/10",    icon: <Mail className="w-3.5 h-3.5" /> },
  signup_submitted:  { color: "text-amber-400",   bg: "bg-amber-500/10",   icon: <Clock className="w-3.5 h-3.5" /> },
  verification_sent: { color: "text-purple-400",  bg: "bg-purple-500/10",  icon: <ExternalLink className="w-3.5 h-3.5" /> },
  failed:            { color: "text-red-400",     bg: "bg-red-500/10",     icon: <XCircle className="w-3.5 h-3.5" /> },
  pending:           { color: "text-zinc-400",    bg: "bg-zinc-500/10",    icon: <Clock className="w-3.5 h-3.5" /> },
};

const logColors: Record<string, string> = {
  info: "text-blue-400",
  success: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const logDots: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Main Page ───

export default function DashboardPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<ReferralConfig | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [signups, setSignups] = useState<SignupRecord[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [workerSlots, setWorkerSlots] = useState<WorkerSlot[]>([]);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [keepAliveStatus, setKeepAliveStatus] = useState<KeepAliveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "history" | "config" | "logs">("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailLog, setDetailLog] = useState<ActivityLog | null>(null);

  // Config form
  const [masterLink, setMasterLink] = useState("");
  const [autoSignup, setAutoSignup] = useState(false);
  const [signupInterval, setSignupInterval] = useState(30);
  const [maxSignups, setMaxSignups] = useState(50);

  // ─── Data Fetching ───

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
      setMasterLink(data.masterLink || "");
      setAutoSignup(data.autoSignup || false);
      setSignupInterval(data.signupInterval || 30);
      setMaxSignups(data.maxSignupsPerDay || 50);
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      setStats(await res.json());
    } catch {}
  }, []);

  const fetchSignups = useCallback(async () => {
    try {
      const res = await fetch("/api/signup/list?limit=50");
      const data = await res.json();
      setSignups(data.records || []);
    } catch {}
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?limit=50");
      setLogs(await res.json());
    } catch {}
  }, []);

  const fetchScheduler = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler");
      const data = await res.json();
      setSchedulerRunning(data.running || false);
      setWorkerSlots(data.workers || []);
    } catch {}
  }, []);

  const fetchProxy = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy");
      setProxyStatus(await res.json());
    } catch {}
  }, []);

  const fetchKeepAlive = useCallback(async () => {
    try {
      const res = await fetch("/api/keepalive");
      const data = await res.json();
      setKeepAliveStatus(data.keepAlive || data);
    } catch {}
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchConfig(), fetchStats(), fetchSignups(), fetchLogs(), fetchScheduler(), fetchProxy(), fetchKeepAlive()]);
    setLoading(false);
  }, [fetchConfig, fetchStats, fetchSignups, fetchLogs, fetchScheduler, fetchProxy, fetchKeepAlive]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      await Promise.all([fetchConfig(), fetchStats(), fetchSignups(), fetchLogs(), fetchScheduler(), fetchProxy(), fetchKeepAlive()]);
      if (mounted) setLoading(false);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ─── Actions ───

  const saveConfig = async () => {
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterLink, autoSignup, signupInterval, maxSignupsPerDay: maxSignups }),
      });
      setConfig(await res.json());
      toast({ title: "Saved", description: "Configuration updated" });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const triggerSignup = async () => {
    setTriggerLoading(true);
    try {
      const res = await fetch("/api/signup/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Signup triggered", description: "Check History for progress" });
      } else {
        toast({ title: "Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
      fetchAll();
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
    setTriggerLoading(false);
  };

  const toggleScheduler = async (start: boolean) => {
    try {
      const res = await fetch("/api/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: start ? "start" : "stop" }),
      });
      const data = await res.json();
      setSchedulerRunning(data.running);
      setWorkerSlots(data.workers || []);
      toast({ title: start ? "5 Workers Started" : "Workers Stopped", description: data.message || (start ? "5 parallel signups running continuously" : "All workers stopped") });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const refreshProxies = async () => {
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json();
      await fetchProxy();
      toast({ title: "Proxies Refreshed", description: `${data.validated || 0} working proxies found` });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const getAiSuggestion = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/suggest", { method: "POST" });
      const data = await res.json();
      if (data.suggestion) setAiSuggestion(data.suggestion);
      else setAiSuggestion("AI suggestions unavailable — check your Groq API key");
    } catch {
      setAiSuggestion("Failed to get AI suggestions");
    }
    setAiLoading(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: text.substring(0, 40) + "..." });
  };

  // ─── Computed ───

  const successRate = stats && stats.totalSignups > 0
    ? ((stats.verifiedSignups / stats.totalSignups) * 100).toFixed(1)
    : "0";

  const tabs = [
    { key: "dashboard" as const, label: "Dashboard", icon: <Activity className="w-4 h-4" /> },
    { key: "history" as const, label: "History", icon: <Clock className="w-4 h-4" /> },
    { key: "config" as const, label: "Config", icon: <Settings className="w-4 h-4" /> },
    { key: "logs" as const, label: "Logs", icon: <Zap className="w-4 h-4" /> },
  ];

  // ─── Render ───

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      {/* ─── Mobile Overlay ─── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar (desktop: always visible, mobile: slide-in) ─── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:z-auto
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo + Close */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Referral Agent</h1>
              <p className="text-[10px] text-zinc-500">TeraBox Automation</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                activeTab === tab.key
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Status Indicator */}
        <div className="p-4 border-t border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className={`w-1.5 h-1.5 rounded-full ${schedulerRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`} />
            {schedulerRunning ? `5 Workers Active` : "Engine Off"}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Globe className="w-3 h-3" />
            <span>{proxyStatus ? `${proxyStatus.poolSize} proxies` : "Proxies: loading"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Brain className="w-3 h-3" />
            <span>AI: Groq + Puppeteer</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Heart className={`w-3 h-3 ${keepAliveStatus?.isRunning ? 'text-rose-400' : ''}`} />
            <span>{keepAliveStatus?.isRunning ? 'Keep-alive ON' : 'Keep-alive: ?'}</span>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
          <div className="px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 -ml-1"
            >
              <Menu className="w-5 h-5" />
            </button>

            <h2 className="text-base sm:text-lg font-semibold capitalize truncate">{activeTab}</h2>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchAll()}
                className="text-zinc-400 hover:text-white h-8 w-8 sm:w-auto p-0 sm:px-3"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline ml-1.5">Refresh</span>
              </Button>
              <Button
                size="sm"
                onClick={triggerSignup}
                disabled={triggerLoading || !config?.masterLink || schedulerRunning}
                className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0 shadow-lg shadow-violet-500/20 h-8"
              >
                {triggerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span className="ml-1.5 hidden sm:inline">1x Signup</span>
              </Button>
              <Button
                size="sm"
                variant={schedulerRunning ? "destructive" : "outline"}
                onClick={() => toggleScheduler(!schedulerRunning)}
                disabled={!config?.masterLink && !schedulerRunning}
                className={`h-8 px-2 sm:px-3 ${schedulerRunning ? "" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                {schedulerRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span className="ml-1.5 hidden sm:inline">{schedulerRunning ? "Stop Engine" : "Start Engine"}</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="p-3 sm:p-6">
          {/* ─── Dashboard Tab ─── */}
          {activeTab === "dashboard" && (
            <div className="space-y-4 sm:space-y-6">
              {/* Stats Grid — 2 cols on mobile, 5 on desktop */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
                {[
                  { label: "Total", value: stats?.totalSignups ?? 0, icon: <Activity className="w-4 h-4" />, accent: "from-violet-500 to-violet-600" },
                  { label: "Verified", value: stats?.verifiedSignups ?? 0, icon: <CheckCircle2 className="w-4 h-4" />, accent: "from-emerald-500 to-emerald-600" },
                  { label: "Pending", value: stats?.pendingSignups ?? 0, icon: <Clock className="w-4 h-4" />, accent: "from-amber-500 to-amber-600" },
                  { label: "Failed", value: stats?.failedSignups ?? 0, icon: <XCircle className="w-4 h-4" />, accent: "from-red-500 to-red-600" },
                  { label: "Rate", value: `${successRate}%`, icon: <TrendingUp className="w-4 h-4" />, accent: "from-fuchsia-500 to-fuchsia-600" },
                ].map((stat) => (
                  <Card key={stat.label} className="bg-zinc-900 border-zinc-800">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] sm:text-xs text-zinc-500 font-medium">{stat.label}</span>
                        <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-gradient-to-br ${stat.accent} flex items-center justify-center opacity-80`}>
                          {cloneIcon(stat.icon, "w-3 h-3 sm:w-3.5 sm:h-3.5 text-white")}
                        </div>
                      </div>
                      <div className="text-xl sm:text-2xl font-bold tracking-tight">{stat.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Two-column: Recent Signups + AI Insights */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Recent Signups */}
                <Card className="lg:col-span-2 bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Recent Signups</CardTitle>
                      <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                        Today: {stats?.todaySignups ?? 0}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {signups.length === 0 ? (
                      <div className="py-8 text-center text-zinc-600 text-sm">
                        No signups yet. Tap &ldquo;Run Signup&rdquo; to start.
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-800">
                        {signups.slice(0, 8).map((s) => {
                          const sc = statusConfig[s.status] || statusConfig.pending;
                          return (
                            <div key={s.id} className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 hover:bg-zinc-800/50 transition-colors">
                              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${sc.bg} flex items-center justify-center ${sc.color} shrink-0`}>
                                {sc.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs sm:text-sm font-medium truncate">{s.email || "pending..."}</div>
                                <div className="text-[10px] sm:text-xs text-zinc-500">{timeAgo(s.createdAt)}</div>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                {s.verificationCode && (
                                  <Badge variant="outline" className="text-[10px] border-emerald-800 text-emerald-400 font-mono">
                                    {s.verificationCode}
                                  </Badge>
                                )}
                                <div className={`text-[10px] sm:text-xs font-medium ${sc.color} hidden sm:block`}>{s.status.replace(/_/g, " ")}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* AI Insights Panel */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Brain className="w-4 h-4 text-violet-400" />
                        AI Insights
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={getAiSuggestion}
                        disabled={aiLoading}
                        className="text-violet-400 hover:text-violet-300 h-7 w-7 p-0"
                      >
                        {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {aiSuggestion ? (
                      <div className="text-xs sm:text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{aiSuggestion}</div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[11px] sm:text-xs text-zinc-500">Tap sparkle to get AI-powered optimization suggestions.</p>
                        <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
                          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
                            <Shield className="w-3 h-3" />
                            Quick Stats
                          </div>
                          <div className="text-xs text-zinc-500 space-y-1">
                            <div>Success: <span className="text-zinc-300">{successRate}%</span></div>
                            <div>Today: <span className="text-zinc-300">{stats?.todaySignups ?? 0}</span></div>
                            <div>Interval: <span className="text-zinc-300">{config?.signupInterval || 30}m</span></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Proxy Status Card */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Globe className="w-4 h-4 text-violet-400" />
                      Proxy / IP Rotation
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={refreshProxies} className="text-violet-400 hover:text-violet-300 h-7 w-7 p-0">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      {proxyStatus && proxyStatus.poolSize > 0 ? (
                        <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                      )}
                      <span className="text-zinc-400">{proxyStatus ? `${proxyStatus.poolSize} proxies` : "Loading..."}</span>
                    </div>
                    <div className="text-zinc-600">Last refresh: {proxyStatus?.lastRefresh === 'never' ? 'never' : proxyStatus?.lastRefresh ? timeAgo(proxyStatus.lastRefresh) : '...'}</div>
                  </div>
                  {!proxyStatus || proxyStatus.poolSize === 0 ? (
                    <p className="text-[10px] text-amber-400/80 mt-2">No proxies available — signups will use direct connection. Click refresh to fetch free proxies.</p>
                  ) : (
                    <p className="text-[10px] text-zinc-500 mt-2">Each signup rotates to a different proxy IP for diversity</p>
                  )}
                </CardContent>
              </Card>

              {/* Keep-Alive Status Card */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Heart className={`w-4 h-4 ${keepAliveStatus?.isRunning ? 'text-rose-400 animate-pulse' : 'text-zinc-500'}`} />
                      24/7 Keep-Alive
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {keepAliveStatus?.isRunning && (
                        <Badge variant="outline" className="text-[10px] border-emerald-800 text-emerald-400">
                          {keepAliveStatus.uptime}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await fetch("/api/keepalive", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: keepAliveStatus?.isRunning ? "stop" : "start" }),
                            });
                            fetchKeepAlive();
                            toast({ title: keepAliveStatus?.isRunning ? "Keep-Alive Stopped" : "Keep-Alive Started" });
                          } catch (error) {
                            toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
                          }
                        }}
                        className="text-violet-400 hover:text-violet-300 h-7 w-7 p-0"
                      >
                        {keepAliveStatus?.isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${keepAliveStatus?.isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                      <span className="text-zinc-400">{keepAliveStatus?.isRunning ? 'Self-ping active' : 'Inactive'}</span>
                    </div>
                    {keepAliveStatus?.isRunning && (
                      <>
                        <div className="text-zinc-600">Pings: <span className="text-zinc-400">{keepAliveStatus.totalPings}</span></div>
                        <div className="text-zinc-600">Rate: <span className="text-emerald-400">{keepAliveStatus.successRate}</span></div>
                        <div className="text-zinc-600">Last: <span className="text-zinc-400">{keepAliveStatus.lastPingAt ? timeAgo(keepAliveStatus.lastPingAt) : '...'}</span></div>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">
                    {keepAliveStatus?.isRunning
                      ? `Pinging ${keepAliveStatus.baseUrl}/api/health every 4 min — prevents Render sleep`
                      : 'Start keep-alive to ping this server every 4 min and prevent Render from sleeping'
                    }
                  </p>
                </CardContent>
              </Card>

              {/* Worker Slots — 5 parallel workers */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${schedulerRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`} />
                      {schedulerRunning ? "Engine Running (5 Workers)" : "Engine Stopped"}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                      {config?.maxSignupsPerDay || 50}/day limit
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {!config?.masterLink ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      Set your master referral link in Config tab first
                    </div>
                  ) : !schedulerRunning ? (
                    <div className="text-center py-4">
                      <p className="text-zinc-500 text-xs mb-3">Press <strong>Start Engine</strong> to begin continuous parallel signups</p>
                      <p className="text-zinc-600 text-[10px]">5 workers will run simultaneously in a continuous loop with proxy rotation</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      {(workerSlots.length > 0 ? workerSlots : Array.from({length: 5}, (_, i) => ({id: i, status: 'running' as const, currentEmail: '', currentStep: 'Starting...', currentProxy: '', startedAt: null, attempts: 0, successes: 0, failures: 0}))).map((w) => (
                        <div key={w.id} className="p-2.5 rounded-lg bg-zinc-800/60 border border-zinc-800">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              w.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                              w.status === 'paused' ? 'bg-amber-500' :
                              w.status === 'stopping' ? 'bg-red-500' : 'bg-zinc-600'
                            }`} />
                            <span className="text-[10px] text-zinc-500">W{w.id + 1}</span>
                            <span className="text-[10px] text-zinc-600 ml-auto">
                              {w.successes > 0 && <span className="text-emerald-400">&#10003;{w.successes}</span>}
                              {w.failures > 0 && <span className="text-red-400 ml-1">&#10007;{w.failures}</span>}
                            </span>
                          </div>
                          <div className="text-[10px] sm:text-xs text-zinc-400 truncate" title={w.currentStep}>
                            {w.currentStep || 'Idle'}
                          </div>
                          {'currentProxy' in w && w.currentProxy && (
                            <div className="text-[9px] text-zinc-600 truncate mt-0.5" title={w.currentProxy}>
                              <Globe className="w-2.5 h-2.5 inline mr-0.5" />{w.currentProxy}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ─── History Tab ─── */}
          {activeTab === "history" && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Signup History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {signups.length === 0 ? (
                  <div className="py-12 text-center text-zinc-600 text-sm">No signups recorded yet</div>
                ) : (
                  <>
                    {/* Mobile: Card list */}
                    <div className="sm:hidden divide-y divide-zinc-800">
                      {signups.map((s) => {
                        const sc = statusConfig[s.status] || statusConfig.pending;
                        return (
                          <div key={s.id} className="p-3 space-y-2 hover:bg-zinc-800/50 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-md ${sc.bg} flex items-center justify-center ${sc.color} shrink-0`}>
                                {cloneIcon(sc.icon, "w-3 h-3")}
                              </div>
                              <span className={`text-[11px] font-medium ${sc.color}`}>{s.status.replace(/_/g, " ")}</span>
                              <span className="text-[10px] text-zinc-600 ml-auto">{timeAgo(s.createdAt)}</span>
                            </div>
                            <div className="text-xs font-mono text-zinc-300 truncate">{s.email || "—"}</div>
                            <div className="flex items-center gap-2">
                              {s.verificationCode && (
                                <Badge variant="outline" className="text-[10px] border-emerald-800 text-emerald-400 font-mono">
                                  {s.verificationCode}
                                </Badge>
                              )}
                              {s.verificationLink && (
                                <a href={s.verificationLink} target="_blank" rel="noopener" className="text-[10px] text-violet-400 hover:text-violet-300 underline underline-offset-2">
                                  verify <ExternalLink className="w-2.5 h-2.5 inline" />
                                </a>
                              )}
                              {s.verificationCode && (
                                <button onClick={() => copyToClipboard(s.verificationCode!)} className="text-zinc-500 hover:text-zinc-300 ml-auto p-1">
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop: Table */}
                    <div className="hidden sm:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-zinc-800 hover:bg-transparent">
                            <TableHead className="text-zinc-500 text-xs">Email</TableHead>
                            <TableHead className="text-zinc-500 text-xs">Status</TableHead>
                            <TableHead className="text-zinc-500 text-xs">Code</TableHead>
                            <TableHead className="text-zinc-500 text-xs">Link</TableHead>
                            <TableHead className="text-zinc-500 text-xs">Time</TableHead>
                            <TableHead className="text-zinc-500 text-xs w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {signups.map((s) => {
                            const sc = statusConfig[s.status] || statusConfig.pending;
                            return (
                              <TableRow key={s.id} className="border-zinc-800 hover:bg-zinc-800/50">
                                <TableCell className="font-mono text-xs">{s.email || "—"}</TableCell>
                                <TableCell>
                                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${sc.color}`}>
                                    {sc.icon} {s.status.replace(/_/g, " ")}
                                  </span>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {s.verificationCode ? (
                                    <span className="text-emerald-400">{s.verificationCode}</span>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {s.verificationLink ? (
                                    <a href={s.verificationLink} target="_blank" rel="noopener" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
                                      verify <ExternalLink className="w-3 h-3 inline" />
                                    </a>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-zinc-500">{timeAgo(s.createdAt)}</TableCell>
                                <TableCell>
                                  {s.verificationCode && (
                                    <button onClick={() => copyToClipboard(s.verificationCode!)} className="text-zinc-500 hover:text-zinc-300">
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ─── Config Tab ─── */}
          {activeTab === "config" && (
            <div className="max-w-2xl space-y-4 sm:space-y-6">
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-violet-400" />
                    Referral Link
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1.5">Master Referral Link</label>
                    <Input
                      value={masterLink}
                      onChange={(e) => setMasterLink(e.target.value)}
                      placeholder="https://www.terabox.com/referral/..."
                      className="bg-zinc-800 border-zinc-700 text-sm placeholder:text-zinc-600"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">The TeraBox webmaster referral link for automated signups</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-violet-400" />
                    Automation Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
                    <div className="text-xs text-zinc-400 space-y-1">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-violet-400" />
                        <span className="font-medium text-zinc-300">Continuous Loop Mode</span>
                      </div>
                      <div>5 parallel workers run continuously. When one signup finishes, a new one starts immediately. No intervals — pure non-stop.</div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-zinc-500 block mb-1.5">Max signups per day</label>
                    <Input
                      type="number"
                      value={maxSignups}
                      onChange={(e) => setMaxSignups(Math.max(1, parseInt(e.target.value) || 1))}
                      min={1}
                      className="bg-zinc-800 border-zinc-700 text-sm"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Workers pause when daily limit is reached, resume next day</p>
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={saveConfig}
                className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0 shadow-lg shadow-violet-500/20 w-full h-10 sm:h-9"
              >
                Save Configuration
              </Button>
            </div>
          )}

          {/* ─── Logs Tab ─── */}
          {activeTab === "logs" && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Activity Logs</CardTitle>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {logs.length} entries
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px] sm:h-[500px]">
                  {logs.length === 0 ? (
                    <div className="py-12 text-center text-zinc-600 text-sm">No activity logs yet</div>
                  ) : (
                    <div className="divide-y divide-zinc-800/50">
                      {logs.map((log) => (
                        <div key={log.id} className="px-3 sm:px-4 py-2.5 flex items-start gap-2 sm:gap-3 hover:bg-zinc-800/30 transition-colors">
                          <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${logDots[log.type] || "bg-zinc-600"}`} />
                          <div className="flex-1 min-w-0">
                            <div className={`text-[11px] sm:text-xs font-medium ${logColors[log.type] || "text-zinc-400"} leading-snug`}>
                              {log.message}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-zinc-600">{timeAgo(log.createdAt)}</span>
                              {(log.type === "error" || log.type === "warn") && (
                                <button
                                  onClick={() => setDetailLog(log)}
                                  className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                  <Eye className="w-3 h-3" />
                                  Detail
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* ─── Log Detail Dialog ─── */}
          <Dialog open={!!detailLog} onOpenChange={(open) => !open && setDetailLog(null)}>
            <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${detailLog ? logDots[detailLog.type] || "bg-zinc-600" : "bg-zinc-600"}`} />
                  <span className={detailLog ? logColors[detailLog.type] || "text-zinc-400" : "text-zinc-400"}>
                    {detailLog?.type?.toUpperCase()} Detail
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-500">
                  {detailLog?.createdAt ? new Date(detailLog.createdAt).toLocaleString() : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {/* Full error message */}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 block">Message</label>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 text-xs text-zinc-300 font-mono break-words whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                    {detailLog?.message}
                  </div>
                </div>
                {/* Metadata */}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 block">Metadata</label>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 text-xs text-zinc-300 font-mono break-words whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                    {detailLog?.metadata
                      ? (() => {
                          try {
                            return JSON.stringify(JSON.parse(detailLog.metadata), null, 2);
                          } catch {
                            return detailLog.metadata;
                          }
                        })()
                      : "—"}
                  </div>
                </div>
                {/* Signup ID if present */}
                {detailLog?.signupId && (
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 block">Signup ID</label>
                    <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 text-xs text-zinc-300 font-mono break-all">
                      {detailLog.signupId}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => {
                    if (!detailLog) return;
                    const fullDetail = [
                      `Type: ${detailLog.type}`,
                      `Time: ${new Date(detailLog.createdAt).toLocaleString()}`,
                      `Message: ${detailLog.message}`,
                      detailLog.metadata ? `Metadata: ${detailLog.metadata}` : null,
                      detailLog.signupId ? `SignupID: ${detailLog.signupId}` : null,
                    ].filter(Boolean).join("\n");
                    navigator.clipboard.writeText(fullDetail);
                    toast({ title: "Copied to clipboard", description: "Error detail copied — paste it to share" });
                  }}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-zinc-400 hover:bg-zinc-800"
                  onClick={() => setDetailLog(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </main>

      {/* ─── Bottom Tab Bar (mobile only) ─── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 md:hidden border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        <div className="grid grid-cols-4 h-14">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                activeTab === tab.key
                  ? "text-violet-400"
                  : "text-zinc-600 active:text-zinc-300"
              }`}
            >
              {cloneIcon(tab.icon, "w-5 h-5")}
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
