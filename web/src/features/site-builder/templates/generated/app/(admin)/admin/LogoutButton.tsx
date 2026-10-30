"use client";

// Signs out of /admin (clears the session cookie) and returns to the login form.
export default function LogoutButton() {
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/admin/login";
  }
  return (
    <button type="button" className="sb-admin-btn secondary" onClick={logout}>
      Sign out
    </button>
  );
}
