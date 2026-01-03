import { Store } from "@tauri-apps/plugin-store";
import type { RecentData } from "../types/recents";
import { DEFAULT_RECENTS } from "../types/recents";

const RECENTS_PATH = "recents.json";
const RECENTS_KEY = "recents";
let store: Store | null = null;

async function initStore(): Promise<void> {
  if (!store) {
    store = await Store.load(RECENTS_PATH);
  }
}

export async function getRecents(): Promise<RecentData> {
  try {
    await initStore();
    const saved = await store?.get<RecentData>(RECENTS_KEY);
    return saved || DEFAULT_RECENTS;
  } catch (error) {
    console.error("Failed to load recents:", error);
    return DEFAULT_RECENTS;
  }
}

export async function saveRecents(recents: RecentData): Promise<void> {
  try {
    await initStore();
    await store?.set(RECENTS_KEY, recents);
    await store?.save();
  } catch (error) {
    console.error("Failed to save recents:", error);
    throw error;
  }
}

export async function resetRecents(): Promise<void> {
  try {
    await initStore();
    await store?.delete(RECENTS_KEY);
    await store?.save();
  } catch (error) {
    console.error("Failed to reset recents:", error);
    throw error;
  }
}
