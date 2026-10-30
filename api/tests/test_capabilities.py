"""Port of capabilities.spec.ts."""
from __future__ import annotations

from app.common.capabilities import CAPABILITIES, USER_GRANTABLE, has_capability
from app.models.enums import Role


def test_every_capability_grants_role_and_super_admin_holds_all():
    for c in CAPABILITIES:
        assert has_capability(Role.SUPER_ADMIN, c) is True
        if c in USER_GRANTABLE:
            continue  # granted per person, not by role — see test below
        assert len(CAPABILITIES[c]) > 0
        assert has_capability(Role.SUPER_ADMIN, c) is True
        assert has_capability(Role.ADMIN, c) is True


def test_marketing_executive_scope():
    exec_role = Role.MARKETING_EXECUTIVE
    assert has_capability(exec_role, "profile.view") is True
    assert has_capability(exec_role, "profile.edit") is True
    for c in ["merchant.create", "merchant.delete", "subscription.write", "accountManager.assign", "accountManager.manage", "users.manage", "audit.view"]:
        assert has_capability(exec_role, c) is False


def test_marketing_manager_scope():
    mgr = Role.MARKETING_MANAGER
    for c in ["merchant.create", "subscription.write", "accountManager.assign", "accountManager.manage", "audit.view"]:
        assert has_capability(mgr, c) is True
    for c in ["merchant.delete", "users.manage", "partners.edit"]:
        assert has_capability(mgr, c) is False


def test_unknown_role_holds_nothing():
    assert has_capability(None, "profile.view") is False
    assert has_capability("CLIENT", "profile.view") is False


def test_ticket_capabilities():
    # Every staff role can see tickets.
    for role in (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE):
        assert has_capability(role, "ticket.view") is True
    # ticket.manage is held by no role — not even ADMIN — only by a per-person grant.
    assert CAPABILITIES["ticket.manage"] == ()
    for role in (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE):
        assert has_capability(role, "ticket.manage") is False
        assert has_capability(role, "ticket.manage", ["ticket.manage"]) is True
    assert has_capability(Role.SUPER_ADMIN, "ticket.manage") is True


def test_grants_cannot_widen_beyond_grantable():
    # A stray value in auth.user.granted_capabilities never grants a
    # role-governed capability.
    assert has_capability(Role.MARKETING_EXECUTIVE, "users.manage", ["users.manage"]) is False
    assert has_capability(Role.MARKETING_EXECUTIVE, "audit.view", ["audit.view", "ticket.manage"]) is False
    # And a user with no role holds nothing, grants included.
    assert has_capability(None, "ticket.manage", ["ticket.manage"]) is False


def test_library_and_vault_capabilities():
    for role in (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE):
        assert has_capability(role, "library.view") and has_capability(role, "library.edit")
        assert has_capability(role, "credentials.view")
    assert has_capability(Role.MARKETING_EXECUTIVE, "library.delete") is False
    assert has_capability(Role.MARKETING_EXECUTIVE, "credentials.reveal") is False
    assert has_capability(Role.MARKETING_EXECUTIVE, "credentials.manage") is False
    # Reveal can be granted to one person; manage can't.
    assert has_capability(Role.MARKETING_EXECUTIVE, "credentials.reveal", ["credentials.reveal"]) is True
    assert has_capability(Role.MARKETING_EXECUTIVE, "credentials.manage", ["credentials.manage"]) is False
    assert has_capability(Role.MARKETING_MANAGER, "credentials.reveal") is True
