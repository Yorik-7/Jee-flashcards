// Distraction-Free Flashcard Study Mode Controller
import { renderStrokesToCanvas } from "./canvas-editor.js";

export class StudySession {
  constructor({ folder, cards, startCardId = null, onUpdateCard, onUpdateFolder, onExit }) {
    this.folder = folder;
    this.originalCards = [...cards];
    this.deck = [...cards];
    this.randomized = false;
    this.revealed = false;
    this.onUpdateCard = onUpdateCard;
    this.onUpdateFolder = onUpdateFolder;
    this.onExit = onExit;

    if (startCardId) {
      const idx = this.deck.findIndex((c) => c.id === startCardId);
      this.index = idx >= 0 ? idx : 0;
    } else if (
      typeof folder.lastStudiedIndex === "number" &&
      folder.lastStudiedIndex >= 0 &&
      folder.lastStudiedIndex < this.deck.length
    ) {
      this.index = folder.lastStudiedIndex;
    } else {
      this.index = 0;
    }

    this.folder.studySessions = (this.folder.studySessions || 0) + 1;
    this.onUpdateFolder(this.folder);
  }

  currentCard() {
    return this.deck[this.index] || null;
  }

  toggleRandomizer() {
    const currentId = this.currentCard()?.id;
    this.randomized = !this.randomized;

    if (this.randomized) {
      // Fisher-Yates shuffle without repeating until deck exhausted
      const rest = this.originalCards.filter((c) => c.id !== currentId);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const current = this.originalCards.find((c) => c.id === currentId);
      this.deck = current ? [current, ...rest] : rest;
      this.index = 0;
    } else {
      this.deck = [...this.originalCards];
      const idx = this.deck.findIndex((c) => c.id === currentId);
      this.index = idx >= 0 ? idx : 0;
    }
    this.revealed = false;
  }

  reveal() {
    this.revealed = true;
  }

  next() {
    if (this.index < this.deck.length - 1) {
      this.index++;
      this.revealed = false;
      this._persistPosition();
      return true;
    }
    return false;
  }

  prev() {
    if (this.index > 0) {
      this.index--;
      this.revealed = false;
      this._persistPosition();
      return true;
    }
    return false;
  }

  async rateCard(difficulty) {
    const card = this.currentCard();
    if (!card) return;
    card.difficulty = difficulty;
    card.lastReviewed = Date.now();
    card.reviewCount = (card.reviewCount || 0) + 1;
    card.updatedAt = Date.now();
    await this.onUpdateCard(card);
    if (this.index < this.deck.length - 1) {
      this.next();
    }
  }

  _persistPosition() {
    if (!this.randomized) {
      this.folder.lastStudiedIndex = this.index;
      this.onUpdateFolder(this.folder);
    }
  }

  renderCanvases(qCanvas, aCanvas) {
    const card = this.currentCard();
    if (!card) return;
    renderStrokesToCanvas(qCanvas, card.questionStrokes || [], card.questionBg || "plain");
    if (this.revealed && aCanvas) {
      renderStrokesToCanvas(aCanvas, card.answerStrokes || [], card.answerBg || "plain");
    }
  }
}
