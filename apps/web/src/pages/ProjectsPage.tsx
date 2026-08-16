import { useCallback, useEffect, useRef, useState } from "react";
import { createProject, loadMembers, loadProjects, updateProject, type Project, type WorkspaceMember } from "../api/client";
import { Icon } from "../components/Icon";
import type { WorkspaceSummary } from "../types/workspace";

export function ProjectsPage({ workspace, accessToken }: { workspace: WorkspaceSummary; accessToken: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newApprover, setNewApprover] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const createInFlight = useRef(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [rows, people] = await Promise.all([loadProjects(workspace.id, accessToken, includeArchived), workspace.membership.role === "admin" ? loadMembers(workspace.id, accessToken) : Promise.resolve([])]);
      setProjects(rows);
      setMembers(people);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [accessToken, includeArchived, workspace.id, workspace.membership.role]);
  useEffect(() => { void load(); }, [load]);

  const change = async (project: Project, changes: { name?: string; approverMembershipId?: string | null; isArchived?: boolean }) => {
    setMessage("");
    try {
      await updateProject(workspace.id, project.id, changes, accessToken);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be updated.");
    }
  };

  const eligible = members.filter((member) => member.isActive && member.role !== "member");

  const create = async () => {
    if (createInFlight.current || !name.trim()) return;
    const normalizedName = name.trim();
    const approverMembershipId = newApprover || null;
    const fingerprint = JSON.stringify({ name: normalizedName, approverMembershipId });
    const attempt = createAttempt.current?.fingerprint === fingerprint ? createAttempt.current : { fingerprint, key: crypto.randomUUID() };
    createAttempt.current = attempt;
    createInFlight.current = true;
    setMessage("");
    setIsCreating(true);
    try {
      await createProject(workspace.id, normalizedName, approverMembershipId, attempt.key, accessToken);
      createAttempt.current = null;
      setCreating(false);
      setName("");
      setNewApprover("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be created.");
    } finally {
      createInFlight.current = false;
      setIsCreating(false);
    }
  };

  if (creating) return <>
    <header className="content-header"><div><button className="link-button" disabled={isCreating} onClick={() => setCreating(false)}><Icon name="chevron-left" size={14} /> Projects</button><h1>New project</h1><p className="page-subtitle">Set an eligible primary approver now, or finish routing later.</p></div></header>
    {message && <div className="inline-alert">{message}</div>}
    <section className="panel entry-editor" aria-busy={isCreating}>
      <label>Project name<input value={name} disabled={isCreating} onChange={(event) => setName(event.target.value)} /></label>
      <label>Primary approver<select value={newApprover} disabled={isCreating} onChange={(event) => setNewApprover(event.target.value)}><option value="">No approver yet</option>{eligible.map((member) => <option key={member.id} value={member.id}>{member.email} ({member.role})</option>)}</select></label>
      <div className="modal-actions entry-editor__wide"><button className="subtle-button" disabled={isCreating} onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={isCreating || !name.trim()} aria-busy={isCreating} onClick={() => void create()}>{isCreating && <span className="button-spinner" aria-hidden="true" />}{isCreating ? "Creating project…" : "Create project"}</button></div>
    </section>
  </>;

  return <>
    <header className="content-header"><div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /> Governance</p><h1>Projects</h1><p className="page-subtitle">Choose one eligible approver per project and keep submission routes healthy.</p></div><div className="row-actions"><label className="check-control"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived</label>{workspace.membership.role === "admin" && <button className="primary-button" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New project</button>}</div></header>
    {message && <div className="inline-alert">{message}</div>}
    {state === "loading" ? <div className="panel inline-state"><strong>Loading projects</strong></div> : state === "error" ? <div className="panel inline-state"><strong>Projects unavailable</strong><button className="subtle-button" onClick={() => void load()}>Try again</button></div> : <section className="project-governance-list">{projects.map((project) => <article className="panel project-governance-card" key={project.id}><div className="project-governance-card__title"><span className="project-avatar">{project.name.slice(0, 2).toUpperCase()}</span><div><h2>{project.name}</h2><span className={project.submissionReady ? "ready-text" : "warning-text"}>{project.submissionReady ? "Ready for submission" : "Approver required"}</span></div></div>{workspace.membership.role === "admin" && <label>Project name<input defaultValue={project.name} disabled={project.isArchived} onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== project.name) void change(project, { name: next }); }} /></label>}<label>Primary approver<select value={project.approverMembershipId ?? ""} disabled={workspace.membership.role !== "admin" || project.isArchived} onChange={(event) => void change(project, { approverMembershipId: event.target.value || null })}><option value="">No approver</option>{eligible.map((member) => <option key={member.id} value={member.id}>{member.email} ({member.role})</option>)}</select></label>{workspace.membership.role === "admin" && <button className="subtle-button" onClick={() => void change(project, { isArchived: !project.isArchived })}>{project.isArchived ? "Restore" : "Archive"}</button>}</article>)}</section>}
  </>;
}
