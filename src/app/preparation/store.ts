import { create } from 'zustand';
export const usePreparationUi = create<{ wellId: string | null; compareOriginals: boolean }>(() => ({ wellId: null, compareOriginals: false }));
