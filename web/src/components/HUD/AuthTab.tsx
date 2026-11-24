import { useState } from "react";
import {
  getAuthStatus,
  authSetPassword,
  authLogin,
  authLogout,
  authRevokeAll,
} from "../../lib/api";
import { useStore } from "../../lib/store";

type Translator = (key: string) => string;

interface AuthTabProps {
  /** i18n translator inherited from the Settings shell. */
  t: Translator;
}

/**
 * Authentication settings tab.
 *
 * Extracted from Settings.tsx because it was previously rendered through an
 * inline IIFE that called `useState` conditionally — a Rules of Hooks
 * violation that crashed React with "Rendered more hooks than during the
 * previous render" as soon as the user switched away from this tab.
 */
export default function AuthTab({ t }: AuthTabProps) {
  const authToken = useStore((s) => s.authToken);
  const authConfigured = useStore((s) => s.authConfigured);
  const setAuthToken = useStore((s) => s.setAuthToken);
  const setAuthConfigured = useStore((s) => s.setAuthConfigured);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"ok" | "error">("ok");

  const showMessage = (text: string, kind: "ok" | "error") => {
    setMessage(text);
    setMessageKind(kind);
    setTimeout(() => setMessage(null), 4000);
  };

  const handleCheckStatus = async () => {
    setLoading(true);
    try {
      const res = await getAuthStatus();
      setAuthConfigured(res.auth_configured);
      showMessage(
        res.auth_configured ? "Authentication is configured" : "No password set",
        "ok",
      );
    } catch {
      showMessage("Failed to check auth status", "error");
    } finally {
      setLoading(false);
    }
  };

  const validateNewPassword = (): boolean => {
    if (password !== confirm) {
      showMessage("Passwords do not match", "error");
      return false;
    }
    if (password.length < 8) {
      showMessage("Password must be at least 8 characters", "error");
      return false;
    }
    return true;
  };

  const handleSetPassword = async () => {
    if (!validateNewPassword()) return;
    setLoading(true);
    try {
      const res = await authSetPassword(password, confirm);
      if (res.ok) {
        if (res.token) {
          setAuthToken(res.token);
          window.dispatchEvent(new CustomEvent("jarvis:authenticated"));
        }
        setAuthConfigured(true);
        setPassword("");
        setConfirm("");
        setCurrentPassword("");
        showMessage(res.message || "Password set successfully", "ok");
      } else {
        showMessage(res.error || "Failed to set password", "error");
      }
    } catch {
      showMessage("Error setting password", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!validateNewPassword()) return;
    if (!currentPassword) {
      showMessage("Current password required", "error");
      return;
    }
    setLoading(true);
    try {
      // Verify the current password before replacing it.
      const loginRes = await authLogin(currentPassword);
      if (!loginRes.ok) {
        showMessage("Current password incorrect", "error");
        return;
      }
      const res = await authSetPassword(password, confirm);
      if (res.ok) {
        setPassword("");
        setConfirm("");
        setCurrentPassword("");
        showMessage(res.message || "Password changed successfully", "ok");
      } else {
        showMessage(res.error || "Failed to change password", "error");
      }
    } catch {
      showMessage("Error changing password", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await authLogin(currentPassword);
      if (res.ok && res.token) {
        setAuthToken(res.token);
        setAuthConfigured(true);
        setCurrentPassword("");
        showMessage("Logged in successfully", "ok");
        // Tell the app shell to reconnect the WebSocket / resume polling.
        window.dispatchEvent(new CustomEvent("jarvis:authenticated"));
      } else {
        showMessage(res.error || "Invalid password", "error");
      }
    } catch {
      showMessage("Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!authToken) return;
    try {
      await authLogout(authToken);
      setAuthToken(null);
      showMessage("Logged out", "ok");
      window.dispatchEvent(new CustomEvent("jarvis:unauthorized"));
    } catch {
      showMessage("Logout failed", "error");
    }
  };

  const handleRevokeAll = async () => {
    if (!authToken) return;
    try {
      const res = await authRevokeAll(authToken);
      setAuthToken(null);
      showMessage(`Revoked ${res.revoked_sessions} sessions`, "ok");
      window.dispatchEvent(new CustomEvent("jarvis:unauthorized"));
    } catch {
      showMessage("Failed to revoke sessions", "error");
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Auth Status Card */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          🔐 {t("auth_status")}
        </h3>
        <div className="flex items-center gap-4 p-4 bg-slate-900/50 rounded-lg">
          <div className={`w-3 h-3 rounded-full ${authConfigured ? "bg-green-500" : "bg-red-500"}`} />
          <div>
            <p className="font-medium text-white">
              {authConfigured ? t("auth_configured") : t("auth_not_configured")}
            </p>
            <p className="text-sm text-slate-400">
              {authConfigured
                ? "A password is set. You can log in to access protected endpoints."
                : "Set a password to enable authentication for API endpoints."}
            </p>
          </div>
        </div>
        <button
          onClick={handleCheckStatus}
          disabled={loading}
          className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-50"
        >
          {loading ? "Checking..." : t("refresh_status")}
        </button>
      </div>

      {/* Set Password / Change Password */}
      {!authConfigured ? (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            🔑 {t("set_password")}
          </h3>
          <p className="text-sm text-slate-400">
            Set a password to enable authentication. Minimum 8 characters.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder={t("password_placeholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              placeholder={t("confirm_password_placeholder")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
            <button
              onClick={handleSetPassword}
              disabled={loading || password.length < 8}
              className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition disabled:opacity-50"
            >
              {loading ? "Setting..." : t("set_password")}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            🔑 {t("change_password")}
          </h3>
          <p className="text-sm text-slate-400">Enter current password to change it.</p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder={t("current_password_placeholder")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              placeholder={t("new_password_placeholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              placeholder={t("confirm_new_password_placeholder")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
            <button
              onClick={handleChangePassword}
              disabled={loading || password.length < 8 || !currentPassword}
              className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition disabled:opacity-50"
            >
              {loading ? "Changing..." : t("change_password")}
            </button>
          </div>
        </div>
      )}

      {/* Login / Logout */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          🚪 {t("session_management")}
        </h3>
        {!authToken ? (
          <div className="space-y-3">
            <input
              type="password"
              placeholder={t("password_placeholder")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
            <button
              onClick={handleLogin}
              disabled={loading || !currentPassword}
              className="w-full px-4 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition disabled:opacity-50"
            >
              {loading ? "Logging in..." : t("login")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <span className="flex items-center gap-2 px-3 py-2 bg-green-500/20 border border-green-500/40 rounded-lg text-green-300 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {t("logged_in")}
            </span>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
            >
              {t("logout")}
            </button>
            <button
              onClick={handleRevokeAll}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
            >
              {t("revoke_all_sessions")}
            </button>
          </div>
        )}
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            messageKind === "ok"
              ? "bg-green-500/20 border-green-500/40 text-green-200"
              : "bg-red-500/20 border-red-500/40 text-red-200"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
