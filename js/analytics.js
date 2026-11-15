// Revision Analytics Calculator
import { SUBJECTS } from "./db.js";

export function computeAnalytics(folders, cards) {
  const totalFolders = folders.length;
  const totalCards = cards.length;
  const cardsStudied = cards.filter((c) => (c.reviewCount || 0) > 0 || c.difficulty !== "new").length;
  const knewCount = cards.filter((c) => c.difficulty === "knew").length;
  const difficultCount = cards.filter((c) => c.difficulty === "difficult").length;
  const forgottenCount = cards.filter((c) => c.difficulty === "forgotten").length;
  const totalSessions = folders.reduce((sum, f) => sum + (f.studySessions || 0), 0);

  const bySubject = SUBJECTS.map((subject) => {
    const sFolders = folders.filter((f) => f.subject === subject);
    const sCards = cards.filter((c) => c.subject === subject);
    const knew = sCards.filter((c) => c.difficulty === "knew").length;
    const difficult = sCards.filter((c) => c.difficulty === "difficult").length;
    const forgotten = sCards.filter((c) => c.difficulty === "forgotten").length;
    const studied = sCards.filter((c) => (c.reviewCount || 0) > 0 || c.difficulty !== "new").length;
    const masteryPct = sCards.length ? Math.round((knew / sCards.length) * 100) : 0;

    return {
      subject,
      foldersCount: sFolders.length,
      cardsCount: sCards.length,
      studied,
      knew,
      difficult,
      forgotten,
      masteryPct
    };
  });

  const byFolder = folders.map((f) => {
    const fCards = cards.filter((c) => c.folderId === f.id);
    const knew = fCards.filter((c) => c.difficulty === "knew").length;
    const difficult = fCards.filter((c) => c.difficulty === "difficult").length;
    const forgotten = fCards.filter((c) => c.difficulty === "forgotten").length;
    const masteryPct = fCards.length ? Math.round((knew / fCards.length) * 100) : 0;

    return {
      id: f.id,
      name: f.name,
      subject: f.subject,
      cardsCount: fCards.length,
      knew,
      difficult,
      forgotten,
      sessions: f.studySessions || 0,
      masteryPct
    };
  });

  return {
    totalFolders,
    totalCards,
    cardsStudied,
    knewCount,
    difficultCount,
    forgottenCount,
    totalSessions,
    bySubject,
    byFolder
  };
}
