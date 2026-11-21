"use client";

import type { Chunk, Lesson } from "./schema";

/**
 * The student's saved lessons, kept in this browser (localStorage) until accounts and private
 * cloud storage are added. Each lesson keeps the chunks of notes it was made from, for the AI
 * teacher's grounding, and where the student left off.
 */
export interface SavedLesson {
  id: string;
  createdAt: number;
  sourceName: string;
  lesson: Lesson;
  chunks: Chunk[];
  progress: { scene: number; completed: boolean };
}

const KEY = "ovr.learning-studio.lessons.v1";

export function loadLessons(): SavedLesson[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedLesson[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: SavedLesson[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // Full or blocked storage: the lesson still works for this session.
  }
}

export function addLesson(entry: Omit<SavedLesson, "id" | "createdAt" | "progress">): SavedLesson {
  const saved: SavedLesson = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    progress: { scene: 0, completed: false },
  };
  save([saved, ...loadLessons()]);
  return saved;
}

export function updateProgress(id: string, scene: number, completed: boolean) {
  save(loadLessons().map((l) => (l.id === id ? { ...l, progress: { scene, completed } } : l)));
}

export function deleteLesson(id: string) {
  save(loadLessons().filter((l) => l.id !== id));
}
