/**
 * NEXUS BLOCKS - Visual Manager
 * Integrates with existing Board.js (Board class, getCell, setCell, clearLine)
 */

class NexusVisualManager {
    constructor(boardInstance, gridElement) {
        this.board = boardInstance;
        this.gridEl = gridElement;
        this.particleContainer = document.getElementById('particle-layer') || document.body;
    }

    /**
     * Renders a piece placement using the Board interface and applies the micro-animation.
     */
    animatePiecePlacement(pieceCoords, pieceColorIndex) {
        pieceCoords.forEach(({ x, y }) => {
            // Update logical board via existing interface
            this.board.setCell(x, y, pieceColorIndex);
            
            // Apply visual styling and animation
            const cellEl = this.getCellElement(x, y);
            if (cellEl) {
                // Apply color CSS variables inline to utilize the Quantum Glass shading from CSS
                cellEl.style.setProperty('--cell-color-base', `var(--piece-${pieceColorIndex}-base)`);
                cellEl.style.setProperty('--cell-color-light', `var(--piece-${pieceColorIndex}-light)`);
                cellEl.style.setProperty('--cell-color-shadow', `var(--piece-${pieceColorIndex}-shadow)`);
                
                cellEl.classList.add('block');
                
                // Trigger placement animation
                cellEl.classList.remove('anim-piece-place');
                void cellEl.offsetWidth; // Force reflow
                cellEl.classList.add('anim-piece-place');
                
                // Cleanup animation class after it finishes
                setTimeout(() => cellEl.classList.remove('anim-piece-place'), 300);
            }
        });
    }

    /**
     * Animates a line clear before actually removing it from the Board.js state.
     */
    async animateLineClear(yIndex) {
        const cellsInLine = [];
        for (let x = 0; x < this.board.width; x++) {
            const cellEl = this.getCellElement(x, yIndex);
            if (cellEl) cellsInLine.push(cellEl);
        }

        // Apply line clear animation
        cellsInLine.forEach(cell => cell.classList.add('anim-line-clear'));

        // Spawn combo burst particles
        this.spawnComboBurst(yIndex);

        // Wait for animation to finish (400ms based on CSS)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Clean up visual state
        cellsInLine.forEach(cell => {
            cell.classList.remove('block', 'anim-line-clear');
            cell.style.removeProperty('--cell-color-base');
            cell.style.removeProperty('--cell-color-light');
            cell.style.removeProperty('--cell-color-shadow');
        });

        // NOTE: board.clearLine() is NOT called here.
        // The logical board state is already cleared by board.processClears()
        // before animateLineClear() is invoked. Calling it again would emit
        // a duplicate 'line:cleared' event and re-zero an already-empty row.
    }

    /**
     * Animates a column clear before the visual cells are wiped.
     * Mirror of animateLineClear() but operates on a vertical column.
     * @param {number} xIndex  Column index (0 = leftmost)
     */
    async animateColumnClear(xIndex) {
        const cellsInCol = [];
        for (let y = 0; y < this.board.height; y++) {
            const cellEl = this.getCellElement(xIndex, y);
            if (cellEl) cellsInCol.push(cellEl);
        }

        cellsInCol.forEach(cell => cell.classList.add('anim-line-clear'));

        this.spawnComboBurst(xIndex);

        await new Promise(resolve => setTimeout(resolve, 400));

        cellsInCol.forEach(cell => {
            cell.classList.remove('block', 'anim-line-clear');
            cell.style.removeProperty('--cell-color-base');
            cell.style.removeProperty('--cell-color-light');
            cell.style.removeProperty('--cell-color-shadow');
        });

        // Logical clear already done by board.processClears(); no second call needed.
    }

    /**
     * Spawns a particle burst for line clears/combos.
     */
    spawnComboBurst(yIndex) {
        const lineRect = this.gridEl.children[yIndex * this.board.width].getBoundingClientRect();
        const centerX = lineRect.left + (this.gridEl.offsetWidth / 2);
        const centerY = lineRect.top + (lineRect.height / 2);
        
        const particleCount = 20;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'nexus-particle';
            
            // Randomize spread
            const angle = Math.random() * Math.PI * 2;
            const radius = 50 + Math.random() * 100;
            const tx = Math.cos(angle) * radius;
            const ty = Math.sin(angle) * radius;
            
            particle.style.cssText = `
                position: absolute;
                left: ${centerX}px;
                top: ${centerY}px;
                width: 6px;
                height: 6px;
                background: var(--accent-combo);
                border-radius: 50%;
                pointer-events: none;
                box-shadow: 0 0 8px var(--accent-nexus);
                transition: transform 0.6s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.6s ease;
                transform: translate(0, 0) scale(1);
            `;
            
            this.particleContainer.appendChild(particle);
            
            // Animate
            requestAnimationFrame(() => {
                particle.style.transform = `translate(${tx}px, ${ty}px) scale(0)`;
                particle.style.opacity = '0';
            });
            
            // Cleanup
            setTimeout(() => particle.remove(), 600);
        }
    }

    // Helper to get DOM element based on grid logic coords
    getCellElement(x, y) {
        // Assumes a flat array of grid cells in the DOM matching width * height
        const index = y * this.board.width + x;
        return this.gridEl.children[index];
    }
}
