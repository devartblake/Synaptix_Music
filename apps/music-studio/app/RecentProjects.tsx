"use client";

import { useEffect, useRef, useState } from "react";
import {
  IndexedDbProjectStorage,
  createStoredProjectRecord,
  type StoredProjectSummary
} from "@synaptix/project-storage";
import { IndexedDbProjectSyncQueue } from "@synaptix/project-storage/platform-sync";
import { createEmptyProject } from "@synaptix/project-model";
import { z } from "zod";
import styles from "./home.module.css";
import {
  createProjectFile,
  PROJECT_FILE_EXTENSION,
  ProjectFileError,
  projectFileName,
  readProjectFile
} from "../lib/editor/project-file";
import { formatBytes } from "../lib/editor/storage-health";
import { useStorageHealth } from "../lib/editor/use-storage-health";

/** Cards shown before "Show all"; the modal search reaches every project. */
const RECENT_LIMIT = 6;

function formatEdited(updatedAt: string): string {
  return new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function RecentProjects() {
  const [projects, setProjects] = useState<StoredProjectSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [cloud, setCloud] = useState<{ projectId: string; name: string }[]>([]);
  const [cloudMessage, setCloudMessage] = useState("");
  const [showAll, setShowAll] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { health: storage, refresh: refreshStorage } = useStorageHealth();

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const project = createEmptyProject(crypto.randomUUID());
      project.metadata.name = name.trim() || "Untitled Project";
      await new IndexedDbProjectStorage().putProject(await createStoredProjectRecord(project));
      window.location.assign(`/studio/${encodeURIComponent(project.projectId)}`);
    } catch {
      setCreateError("Could not create the project. Check browser storage and retry.");
      setBusy(false);
    }
  }
  async function exportProject(projectId: string) {
    setError(null);
    try {
      const record = await new IndexedDbProjectStorage().getProject(projectId);
      if (!record) throw new Error("missing");
      const text = await createProjectFile(record.project);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = projectFileName(record.project);
      link.click();
      // Give the browser a moment to start the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not export this project. Check browser storage and retry.");
    }
  }

  async function importProject(file: File) {
    setBusy(true);
    setImportError(null);
    try {
      const project = await readProjectFile(await file.text());
      await new IndexedDbProjectStorage().putProject(await createStoredProjectRecord(project));
      window.location.assign(`/studio/${encodeURIComponent(project.projectId)}`);
    } catch (cause) {
      setImportError(
        cause instanceof ProjectFileError
          ? cause.message
          : "Could not import this project. Check browser storage and retry."
      );
      setBusy(false);
    }
  }

  async function remove(projectId: string) {
    setBusy(true);
    setError(null);
    try {
      const queue = new IndexedDbProjectSyncQueue();
      for (const operation of await queue.list())
        if (operation.projectId === projectId) await queue.remove(operation.operationId);
      await new IndexedDbProjectStorage().deleteProject(projectId);
      localStorage.removeItem(`synaptix-music:export-request:v1:${projectId}`);
      localStorage.removeItem(`synaptix-music:adaptive:v1:${projectId}`);
      setProjects((current) => current.filter((project) => project.projectId !== projectId));
      setDeleting(null);
      refreshStorage();
    } catch {
      setError(
        "Could not finish deleting this local project. Retry when browser storage is available."
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadCloud() {
    setBusy(true);
    setCloudMessage("Loading cloud projects…");
    try {
      const response = await fetch("/api/platform/projects", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Sign in to the platform to browse cloud projects."
            : "Cloud projects are unavailable. Try again."
        );
      const values = z
        .array(z.object({ projectId: z.string().min(1), name: z.string(), archived: z.boolean() }))
        .parse(await response.json());
      setCloud(values.filter((project) => !project.archived));
      setCloudMessage("Cloud projects loaded.");
    } catch (cause) {
      setCloudMessage(cause instanceof Error ? cause.message : "Cloud projects unavailable.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const saved = await new IndexedDbProjectStorage().listProjects();
        if (!cancelled) {
          setProjects(saved);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status === "loading")
    return (
      <p className={styles.projectMessage} role="status">
        Loading your local projects…
      </p>
    );
  if (status === "error")
    return (
      <div className={styles.projectMessage} role="status">
        <p>
          Your saved projects couldn’t be read. Check that browser storage is available, then try
          again.
        </p>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry loading projects</button>
      </div>
    );
  const sorted = [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const matches = sorted.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const visible = showAll ? sorted : sorted.slice(0, RECENT_LIMIT);

  const toolbar = (
    <div className={styles.projectToolbar}>
      <p className={styles.projectCount}>
        {projects.length === 0
          ? "No local projects yet"
          : `${projects.length} local project${projects.length === 1 ? "" : "s"}`}
        {storage.usageBytes !== null && storage.quotaBytes !== null && (
          <> · {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)} browser storage used</>
        )}
      </p>
      <button
        className={styles.projectToolsButton}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        Find or create project
      </button>
    </div>
  );

  const dialog = (
    <dialog
      ref={dialogRef}
      className={styles.projectDialog}
      aria-labelledby="project-tools-heading"
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className={styles.projectDialogBody}>
        <header className={styles.projectDialogHeader}>
          <h3 id="project-tools-heading">Find or create a project</h3>
          <button aria-label="Close" onClick={() => dialogRef.current?.close()}>
            ✕
          </button>
        </header>

        <section aria-labelledby="create-project-heading">
          <h4 id="create-project-heading">New project</h4>
          <form
            className={styles.projectDialogRow}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              New project name
              <input
                value={name}
                maxLength={200}
                placeholder="Untitled Project"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button className={styles.projectToolsButton} disabled={busy} type="submit">
              Create project
            </button>
          </form>
          {createError && <p role="alert">{createError}</p>}
        </section>

        <section aria-labelledby="search-projects-heading">
          <h4 id="search-projects-heading">Projects in this browser</h4>
          <label>
            Search projects
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {projects.length > 0 && !matches.length && (
            <p role="status">No matching local projects.</p>
          )}
          {matches.length > 0 && (
            <ul className={styles.projectResults} aria-label="Matching local projects">
              {matches.map((project) => (
                <li key={project.projectId}>
                  <a href={`/studio/${encodeURIComponent(project.projectId)}`}>
                    <span>{project.name}</span>
                    <small>Edited {formatEdited(project.updatedAt)}</small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="import-project-heading">
          <h4 id="import-project-heading">Import a project file</h4>
          <label>
            Project file ({PROJECT_FILE_EXTENSION})
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importProject(file);
              }}
            />
          </label>
          <p>Imports as a new copy in this browser; your existing projects are never overwritten.</p>
          {importError && <p role="alert">{importError}</p>}
        </section>

        <section aria-labelledby="cloud-projects-heading">
          <h4 id="cloud-projects-heading">Cloud projects</h4>
          <button disabled={busy} onClick={() => void loadCloud()}>
            Browse cloud projects
          </button>
          {cloudMessage && <p role="status">{cloudMessage}</p>}
          {cloudMessage === "Cloud projects loaded." && (
            <ul className={styles.projectResults} aria-label="Cloud projects">
              {cloud
                .filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()))
                .map((project) => (
                  <li key={project.projectId}>
                    <a href={`/studio/${encodeURIComponent(project.projectId)}`}>
                      {project.name} · Cloud
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  );

  const storageWarning = (storage.level === "warning" || storage.level === "critical") && (
    <p className={styles.storageWarning} role="status">
      <strong>
        {storage.level === "critical" ? "Browser storage is almost full." : "Browser storage is getting full."}
      </strong>{" "}
      New edits may stop saving. Export projects you want to keep, then delete ones you no longer
      need.
    </p>
  );

  if (projects.length === 0)
    return (
      <>
        {toolbar}
        {storageWarning}
        {dialog}
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ♫
          </span>
          <div>
            <h3>Your first session starts here.</h3>
            <p>
              Open the demo and make an edit. Your saved projects will appear here when you return.
            </p>
          </div>
          <a className={styles.textLink} href="/studio/local-demo">
            Explore the demo <span aria-hidden="true">→</span>
          </a>
        </div>
      </>
    );

  return (
    <>
      {toolbar}
      {storageWarning}
      {dialog}
      {error && <p role="alert">{error}</p>}
      <ul className={styles.projectGrid}>
        {visible.map((project) => (
          <li key={project.projectId} className={styles.projectItem}>
            <a
              className={styles.projectCard}
              href={`/studio/${encodeURIComponent(project.projectId)}`}
            >
              <span className={styles.projectCardTop}>
                <span className={styles.projectIcon} aria-hidden="true">
                  ♫
                </span>
                <span aria-hidden="true">↗</span>
              </span>
              <h3>{project.name}</h3>
              <p>
                Edited <time dateTime={project.updatedAt}>{formatEdited(project.updatedAt)}</time>
              </p>
              <span className={styles.textLink}>
                Continue project <span aria-hidden="true">→</span>
              </span>
            </a>
            <div className={styles.projectCardFooter}>
              {deleting === project.projectId ? (
                <div className={styles.deletePrompt}>
                  <p>
                    Delete {project.name} from this browser, including local revisions and pending
                    sync? Cloud copies remain.
                  </p>
                  <button disabled={busy} onClick={() => void remove(project.projectId)}>
                    Confirm local deletion
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(null)}>
                    Keep project
                  </button>
                </div>
              ) : (
                <div className={styles.projectCardActions}>
                  <button
                    className={styles.deleteLink}
                    disabled={busy}
                    aria-label={`Export ${project.name} as a file`}
                    onClick={() => void exportProject(project.projectId)}
                  >
                    Export
                  </button>
                  <button
                    className={styles.deleteLink}
                    disabled={busy}
                    aria-label={`Delete local project ${project.name}`}
                    onClick={() => setDeleting(project.projectId)}
                  >
                    Delete local copy
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {sorted.length > RECENT_LIMIT && (
        <button className={styles.showAllButton} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show recent projects only" : `Show all ${sorted.length} projects`}
        </button>
      )}
    </>
  );
}
