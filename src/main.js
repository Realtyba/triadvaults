import { GameApp } from './game/GameApp.js';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  window.gameApp = new GameApp(container);
});
