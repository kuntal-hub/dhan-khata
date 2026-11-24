"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { Choice, TextField } from "@/components/forms/fields";
import { Loading } from "@/components/lists/common";
import { PageHeader, ReadOnlyNotice } from "@/components/system/page";
import {
  addUserOnline,
  listUsersOnline,
  resetUserPasswordOnline,
  revokeDeviceOnline,
  setUserAccessOnline,
  type GodownAccess,
} from "@/client/admin";
import { errorKey } from "@/client/errors";
import { useAccessibleGodowns, useSessionMeta } from "@/client/hooks";
import { dot } from "@/client/ui/text";
import type { Device, GodownRole, User } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

type RoleChoice = GodownRole | "none";

/** Per-godown role editor: none / manager / entry / viewer + "see all godowns". */
function AccessEditor({
  value,
  onChange,
}: {
  value: GodownAccess[];
  onChange: (v: GodownAccess[]) => void;
}) {
  const { t } = useI18n();
  const godowns = (useAccessibleGodowns() ?? []).filter((g) => g.status === "active");
  const set = (godownId: string, role: RoleChoice, consolidated?: boolean) => {
    const rest = value.filter((a) => a.godownId !== godownId);
    onChange(
      role === "none"
        ? rest
        : [...rest, { godownId, role, ...(consolidated ? { consolidated } : {}) }],
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{t("users.access")}</span>
      {godowns.map((g) => {
        const a = value.find((x) => x.godownId === g._id);
        return (
          <div
            key={g._id}
            className="flex flex-col gap-1 rounded-md border p-2"
            data-testid={`access-${g.code}`}
          >
            <span className="text-sm font-semibold">{g.name}</span>
            <Choice<RoleChoice>
              value={a?.role ?? "none"}
              wrap
              onChange={(role) => set(g._id, role, a?.consolidated)}
              options={[
                { value: "none", label: t("users.none") },
                { value: "manager", label: t("role.manager") },
                { value: "entry", label: t("role.entry") },
                { value: "viewer", label: t("role.viewer") },
              ]}
            />
            {a ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={a.consolidated === true}
                  onChange={(e) => set(g._id, a.role, e.target.checked)}
                />
                {t("users.consolidated")}
              </label>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function UserEditor({ user, onDone }: { user: User | "new"; onDone: () => void }) {
  const { t } = useI18n();
  const isNew = user === "new";
  const [name, setName] = useState(isNew ? "" : user.name);
  const [phone, setPhone] = useState(isNew ? "" : user.phone);
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState<GodownAccess[]>(isNew ? [] : user.godownAccess);
  const [active, setActive] = useState(isNew ? true : user.active);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        await addUserOnline({
          name: name.trim(),
          phone: phone.trim(),
          password,
          godownAccess: access,
        });
        toast.success(t("users.created"));
      } else {
        await setUserAccessOnline(user._id, access, active);
        if (password) await resetUserPasswordOnline(user._id, password);
        toast.success(t("common.saved"));
      }
      onDone();
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onDone()}
      title={isNew ? t("users.add") : user.name}
    >
      {isNew ? (
        <>
          <TextField
            label={t("users.name")}
            value={name}
            onChange={setName}
            required
            testId="user-name"
          />
          <TextField
            label={t("users.phone")}
            value={phone}
            onChange={setPhone}
            inputMode="tel"
            required
            testId="user-phone"
          />
        </>
      ) : null}
      <TextField
        label={isNew ? t("users.password") : t("users.resetPassword")}
        value={password}
        onChange={setPassword}
        required={isNew}
        testId="user-password"
      />
      <AccessEditor value={access} onChange={setAccess} />
      {!isNew ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t("users.active")}
        </label>
      ) : null}
      <p className="text-muted-foreground text-xs">{t("settings.onlineNeeded")}</p>
      <Button
        className="h-12"
        disabled={
          busy || (isNew && (!name.trim() || phone.trim().length < 10 || password.length < 6))
        }
        onClick={() => void save()}
        data-testid="user-save"
      >
        {isNew ? t("common.save") : t("users.saveAccess")}
      </Button>
    </BottomSheet>
  );
}

/** Owner: users with per-godown roles + consolidated, and devices (revoke) — spec §9.16. */
export default function UsersPage() {
  const { t, date } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const session = useSessionMeta();
  const godowns = useAccessibleGodowns() ?? [];
  const [data, setData] = useState<{ users: User[]; devices: Device[] } | null>(null);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<User | "new" | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isOwner) return;
    listUsersOnline()
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, [isOwner, tick]);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  const refresh = () => setTick((x) => x + 1);
  const revoke = async (id: string) => {
    try {
      await revokeDeviceOnline(id);
      refresh();
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  const godownName = (id: string) => godowns.find((g) => g._id === id)?.name ?? "";
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("users.title")}
        actions={
          <Button className="h-11" onClick={() => setEdit("new")} data-testid="user-add">
            <Plus className="size-4" aria-hidden />
            {t("users.add")}
          </Button>
        }
      />
      {error ? <p className="text-destructive text-sm">{t("settings.onlineNeeded")}</p> : null}
      {!data && !error ? <Loading /> : null}
      {data
        ? data.users.map((u) => (
            <Card key={u._id} data-testid="user-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {u.name}
                  {u.isOwner ? <Badge>{t("users.owner")}</Badge> : null}
                  {!u.active ? <Badge variant="destructive">{t("users.inactive")}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <span className="text-muted-foreground">{u.phone}</span>
                {!u.isOwner ? (
                  <span>
                    {u.godownAccess.length === 0
                      ? t("users.none")
                      : u.godownAccess
                          .map((a) => dot(godownName(a.godownId), t(`role.${a.role}`)))
                          .join(" | ")}
                  </span>
                ) : null}
                {!u.isOwner ? (
                  <Button variant="outline" className="h-11 self-start" onClick={() => setEdit(u)}>
                    {t("common.edit")}
                  </Button>
                ) : null}
                <ul className="flex flex-col gap-1">
                  {data.devices
                    .filter((d) => d.userId === u._id)
                    .map((d) => (
                      <li
                        key={d._id}
                        className="flex flex-wrap items-center justify-between gap-2 border-t pt-1"
                      >
                        <span className="min-w-0 truncate">
                          {dot(
                            d.code,
                            d.label,
                            t("users.lastSeen", { date: date(d.lastSeenAt.slice(0, 10), "short") }),
                            d._id === session?.deviceId ? t("users.thisDevice") : null,
                          )}
                        </span>
                        {d.revokedAt ? (
                          <Badge variant="destructive">{t("users.revoked")}</Badge>
                        ) : d._id !== session?.deviceId ? (
                          <Button
                            variant="ghost"
                            className="h-11"
                            onClick={() => void revoke(d._id)}
                          >
                            {t("users.revoke")}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))
        : null}
      {edit ? (
        <UserEditor
          user={edit}
          onDone={() => {
            setEdit(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
