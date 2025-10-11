const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pageList = document.getElementById('page-list');
const contentSection = document.getElementById('content-section');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const selectionBar = document.getElementById('selection-bar');
const minThumb = document.getElementById('min-thumb');
const maxThumb = document.getElementById('max-thumb');


const pages = [];
let currentPageIndex = -1;
let selectionMin = 0;
let selectionMax = 0;

// --- File Handling ---

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    handleFiles(files);
});

function handleFiles(files) {
    if (files.length === 0) return;

    const newFiles = Array.from(files).filter(file => file);
    let firstNewPageIndex = pages.length;

    const readPromises = newFiles.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const pageData = parseTopFile(e.target.result);
                pages.push({ name: file.name, data: pageData });
                resolve();
            };
            reader.readAsArrayBuffer(file);
        });
    });

    Promise.all(readPromises).then(() => {
        renderPageList();
        if (currentPageIndex === -1 && pages.length > 0) {
            switchPage(0);
        } else {
            // Re-select the current page to ensure the view is consistent
            // especially if files were added while a page was active.
            switchPage(currentPageIndex);
        }
    });
}

// --- TOP File Parser ---

const TOP_HEADER_SIZE = 32;
const TOP_PACKET_SIZE = 6;
const TOP_HEIGHT = 12000;

function parseTopFile(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const paths = [];
    let currentPath = [];

    for (let offset = TOP_HEADER_SIZE; offset + TOP_PACKET_SIZE <= view.byteLength; offset += TOP_PACKET_SIZE) {
        const penStatus = view.getUint8(offset);
        const y = view.getInt16(offset + 1, true); // true for little-endian
        const x = view.getInt16(offset + 3, true); // true for little-endian

        if (currentPath.length === 0) {
            paths.push(currentPath);
        }

        currentPath.push({ x, y: TOP_HEIGHT - y });

        if (penStatus === 0) {
            currentPath = [];
        }
    }
    return paths.filter(path => path.length > 0);
}

// --- Page Switching ---

// --- Page List Rendering ---

function renderPageList() {
    pageList.innerHTML = ''; // Clear existing list
    closeContextMenu(); // Close any open context menus

    pages.forEach((page, index) => {
        const listItem = document.createElement('li');
        listItem.dataset.index = index;
        listItem.draggable = true;

        if (index === currentPageIndex) {
            listItem.classList.add('active');
        }

        // Make the entire list item clickable, not just the text
        listItem.addEventListener('click', () => switchPage(index));

        const pageName = document.createElement('span');
        pageName.className = 'page-name';
        pageName.textContent = page.name;

        const menuButton = document.createElement('button');
        menuButton.className = 'context-menu-button';
        menuButton.innerHTML = '&#x22EE;'; // Vertical ellipsis
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            showContextMenu(e.currentTarget, index);
        });

        listItem.appendChild(pageName);
        listItem.appendChild(menuButton);
        pageList.appendChild(listItem);
    });

    addDragDropListeners();
}

function switchPage(index) {
    if (index < 0 || index >= pages.length) {
        // If the current page was deleted, switch to a valid one
        if (pages.length === 0) {
            currentPageIndex = -1;
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
        } else {
            currentPageIndex = Math.max(0, Math.min(index, pages.length - 1));
        }
    } else {
        currentPageIndex = index;
    }


    selectionMin = 0;
    selectionMax = 0;

    renderPageList(); // Re-render to update the 'active' state
    drawCurrentPage();
    updateThumbs();
}

// --- Canvas Drawing ---

const PAGE_ASPECT_RATIO = 210 / 297; // A4 paper
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let splitPreview = null; // Holds info for split preview: { index, splitPoint }


function resizeCanvas() {
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;

    // Set canvas drawing buffer size
    canvas.width = containerWidth;
    canvas.height = containerHeight;

    drawCurrentPage();
}

window.addEventListener('resize', resizeCanvas);


function drawCurrentPage() {
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const page = pages[currentPageIndex];
    const containerWidth = canvas.width;
    const containerHeight = canvas.height;

    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    const margin = 20;
    let paperWidth, paperHeight;

    if ((containerWidth - 2 * margin) / (containerHeight - 2 * margin) > PAGE_ASPECT_RATIO) {
        paperHeight = (containerHeight - 2 * margin) * scale;
        paperWidth = paperHeight * PAGE_ASPECT_RATIO;
    } else {
        paperWidth = (containerWidth - 2 * margin) * scale;
        paperHeight = paperWidth / PAGE_ASPECT_RATIO;
    }

    const panMargin = 20;
    if (paperWidth > containerWidth) {
        panX = Math.max(-(paperWidth - containerWidth) - panMargin, Math.min(margin, panX));
    } else {
        panX = 0;
    }
    if (paperHeight > containerHeight) {
        panY = Math.max(-(paperHeight - containerHeight) - margin, Math.min(margin, panY));
    } else {
        panY = 0;
    }

    let paperX = (paperWidth < containerWidth) ? (containerWidth - paperWidth) / 2 : panX;
    let paperY = (paperHeight < containerHeight) ? (containerHeight - paperHeight) / 2 : panY;

    ctx.fillStyle = 'white';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.fillRect(paperX, paperY, paperWidth, paperHeight);
    ctx.shadowColor = 'transparent';
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(paperX, paperY, paperWidth, paperHeight);
    ctx.clip();
    ctx.translate(paperX, paperY);

    const contentScale = paperWidth / 8800;
    ctx.scale(contentScale, contentScale);

    const baseLineWidth = 1 / contentScale;

    // Handle split preview rendering
    if (splitPreview && splitPreview.index === currentPageIndex) {
        const splitPoint = splitPreview.splitPoint;
        page.data.forEach((path, i) => {
            if (path.length > 0) {
                ctx.strokeStyle = i < splitPoint ? 'blue' : 'red';
                ctx.lineWidth = baseLineWidth;
                ctx.beginPath();
                ctx.moveTo(path[0].x, path[0].y);
                for (let j = 1; j < path.length; j++) {
                    ctx.lineTo(path[j].x, path[j].y);
                }
                ctx.stroke();
            }
        });
    } else {
        // Standard rendering
        page.data.forEach((path, i) => {
            if (path.length > 0) {
                const isSelected = i >= selectionMin && i < selectionMax;
                ctx.strokeStyle = isSelected ? 'blue' : 'black';
                ctx.lineWidth = isSelected ? baseLineWidth * 3 : baseLineWidth;
                ctx.beginPath();
                ctx.moveTo(path[0].x, path[0].y);
                for (let j = 1; j < path.length; j++) {
                    ctx.lineTo(path[j].x, path[j].y);
                }
                ctx.stroke();
            }
        });
    }

    ctx.restore();
}

function splitPage(index) {
    const splitPoint = selectionMin;
    const page = pages[index];

    // Set up preview and redraw
    splitPreview = { index, splitPoint };
    drawCurrentPage();

    const message = `Split this page into two? Page "a" will have ${splitPoint} paths (blue), and page "b" will have ${page.data.length - splitPoint} paths (red).`;

    // Use a timeout to allow the canvas to redraw *before* the confirm dialog blocks the main thread
    setTimeout(() => {
        const confirmed = window.confirm(message);

        if (confirmed) {
            const originalName = page.name;
            const dataA = page.data.slice(0, splitPoint);
            const dataB = page.data.slice(splitPoint);

            const pageA = { name: `${originalName}-a`, data: dataA };
            const pageB = { name: `${originalName}-b`, data: dataB };

            pages.splice(index, 1, pageA, pageB);

            splitPreview = null;
            switchPage(index);
        } else {
            // If cancelled, reset preview and redraw
            splitPreview = null;
            drawCurrentPage();
        }
    }, 10); // A small delay is enough
}


// --- Context Menu ---
let contextMenu = null;

function showContextMenu(button, pageIndex) {
    closeContextMenu();

    const rect = button.getBoundingClientRect();
    contextMenu = document.createElement('ul');
    contextMenu.className = 'context-menu';
    contextMenu.style.position = 'absolute';
    contextMenu.style.top = `${rect.bottom}px`;
    contextMenu.style.left = `${rect.left}px`;

    const createMenuItem = (text, action, disabled = false) => {
        const item = document.createElement('li');
        item.textContent = text;
        if (disabled) {
            item.classList.add('disabled');
        } else {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                action();
                closeContextMenu();
            });
        }
        return item;
    };

    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === pages.length - 1;
    const page = pages[pageIndex];
    const totalPaths = page.data.length;

    // Condition for splitting: min thumb is between the start and end, and selection range is zero
    const canSplit = selectionMin > 0 && selectionMin < totalPaths && selectionMin === selectionMax;

    contextMenu.appendChild(
        createMenuItem('Move Page Up', () => movePage(pageIndex, pageIndex - 1), isFirstPage)
    );
    contextMenu.appendChild(
        createMenuItem('Move Page Down', () => movePage(pageIndex, pageIndex + 1), isLastPage)
    );
    contextMenu.appendChild(document.createElement('hr'));
    contextMenu.appendChild(
        createMenuItem('Merge Page Up', () => mergePage(pageIndex, 'up'), isFirstPage)
    );
    contextMenu.appendChild(
        createMenuItem('Merge Page Down', () => mergePage(pageIndex, 'down'), isLastPage)
    );
    contextMenu.appendChild(document.createElement('hr'));
    contextMenu.appendChild(
        createMenuItem('Split Page', () => splitPage(pageIndex), !canSplit)
    );
    contextMenu.appendChild(document.createElement('hr'));
    contextMenu.appendChild(createMenuItem('Rename Page', () => startRenaming(pageIndex)));
    contextMenu.appendChild(document.createElement('hr'));
    contextMenu.appendChild(createMenuItem('Delete Page', () => deletePage(pageIndex)));

    document.body.appendChild(contextMenu);
}

function closeContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
}

window.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target) && !e.target.classList.contains('context-menu-button')) {
        closeContextMenu();
    }
});


// --- User Interaction for Pan and Zoom ---

contentSection.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
        const zoomIntensity = 0.05;
        const scroll = e.deltaY < 0 ? 1 : -1;
        const zoom = Math.exp(scroll * zoomIntensity);
        const rect = contentSection.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mouseBeforeZoomX = (mouseX - panX) / scale;
        const mouseBeforeZoomY = (mouseY - panY) / scale;
        scale *= zoom;
        const mouseAfterZoomX = (mouseX - panX) / scale;
        const mouseAfterZoomY = (mouseY - panY) / scale;
        panX += (mouseAfterZoomX - mouseBeforeZoomX) * scale;
        panY += (mouseAfterZoomY - mouseBeforeZoomY) * scale;
    } else if (e.shiftKey) {
        panX -= e.deltaY;
    } else {
        panY -= e.deltaY;
    }
    drawCurrentPage();
});

canvasContainer.addEventListener('mousedown', (e) => {
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    canvasContainer.style.cursor = 'grabbing';
});

canvasContainer.addEventListener('mouseup', () => {
    isPanning = false;
    canvasContainer.style.cursor = 'grab';
});

canvasContainer.addEventListener('mouseleave', () => {
    isPanning = false;
    canvasContainer.style.cursor = 'default';
});

canvasContainer.addEventListener('mousemove', (e) => {
    if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        panX += dx;
        panY += dy;
        panStart.x = e.clientX;
        panStart.y = e.clientY;
        drawCurrentPage();
    }
});

// --- Selection Bar Interaction ---

function updateThumbs() {
    if (currentPageIndex < 0) return;
    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;
    if (totalPaths === 0) {
        minThumb.style.top = '0%';
        maxThumb.style.top = '0%';
        return;
    }
    const minPercent = (selectionMin / totalPaths) * 100;
    const maxPercent = (selectionMax / totalPaths) * 100;
    minThumb.style.top = `${minPercent}%`;
    maxThumb.style.top = `${maxPercent}%`;
}

let activeThumb = null;

function onThumbMouseDown(event) {
    activeThumb = event.target === minThumb ? minThumb : maxThumb;
    document.addEventListener('mousemove', onThumbMouseMove);
    document.addEventListener('mouseup', onThumbMouseUp);
}

function onThumbMouseUp() {
    activeThumb = null;
    document.removeEventListener('mousemove', onThumbMouseMove);
    document.removeEventListener('mouseup', onThumbMouseUp);
}

function onThumbMouseMove(event) {
    if (!activeThumb || currentPageIndex < 0) return;
    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;
    if (totalPaths <= 1) return;
    const barRect = selectionBar.getBoundingClientRect();
    const offsetY = event.clientY - barRect.top;
    const percent = Math.max(0, Math.min(100, (offsetY / barRect.height) * 100));
    const value = Math.round((totalPaths * percent) / 100);
    if (activeThumb === minThumb) {
        selectionMin = Math.min(value, selectionMax);
    } else {
        selectionMax = Math.max(value, selectionMin);
    }
    selectionMin = Math.max(0, selectionMin);
    selectionMax = Math.min(totalPaths, selectionMax);
    updateThumbs();
    drawCurrentPage();
}

minThumb.addEventListener('mousedown', onThumbMouseDown);
maxThumb.addEventListener('mousedown', onThumbMouseDown);

function handleThumbKeyDown(event) {
    const thumb = event.target;
    let step = 0;
    if (event.key === 'ArrowUp') step = -1;
    else if (event.key === 'ArrowDown') step = 1;
    else if (event.key === 'PageUp') step = -100;
    else if (event.key === 'PageDown') step = 100;
    if (step === 0 || currentPageIndex < 0) return;
    event.preventDefault();
    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;
    if (thumb === minThumb) {
        selectionMin = Math.max(0, Math.min(selectionMin + step, selectionMax));
    } else {
        selectionMax = Math.max(selectionMin, Math.min(selectionMax + step, totalPaths));
    }
    updateThumbs();
    drawCurrentPage();
}

minThumb.addEventListener('keydown', handleThumbKeyDown);
maxThumb.addEventListener('keydown', handleThumbKeyDown);

// --- Page Reordering ---

function movePage(oldIndex, newIndex) {
    if (newIndex < 0 || newIndex >= pages.length || oldIndex === newIndex) return;

    const [movedPage] = pages.splice(oldIndex, 1);
    pages.splice(newIndex, 0, movedPage);

    if (currentPageIndex === oldIndex) {
        currentPageIndex = newIndex;
    } else if (currentPageIndex > oldIndex && currentPageIndex <= newIndex) {
        currentPageIndex--;
    } else if (currentPageIndex < oldIndex && currentPageIndex >= newIndex) {
        currentPageIndex++;
    }
    renderPageList();
}

function mergePage(index, direction) {
    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    if (otherIndex < 0 || otherIndex >= pages.length) return;

    const topPage = direction === 'up' ? pages[otherIndex] : pages[index];
    const bottomPage = direction === 'up' ? pages[index] : pages[otherIndex];
    const topIndex = Math.min(index, otherIndex);

    const newName = `${topPage.name}-${bottomPage.name}`;
    const message = `Are you sure you want to merge "${topPage.name}" and "${bottomPage.name}" into a new page named "${newName}"?`;

    if (window.confirm(message)) {
        const mergedData = topPage.data.concat(bottomPage.data);
        const mergedPage = { name: newName, data: mergedData };

        // Remove the two old pages and add the new one
        pages.splice(topIndex, 2, mergedPage);

        // Switch to the new merged page
        switchPage(topIndex);
    }
}

let draggedIndex = null;

function addDragDropListeners() {
    const listItems = pageList.querySelectorAll('li');

    const clearIndicators = () => {
        listItems.forEach(i => {
            i.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
        });
    };

    listItems.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('context-menu-button')) {
                e.preventDefault();
                return;
            }
            draggedIndex = parseInt(e.currentTarget.dataset.index, 10);
            // Use a timeout to avoid capturing the 'dragging' state in the drag image
            setTimeout(() => e.currentTarget.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', (e) => {
            clearIndicators();
            e.currentTarget.classList.remove('dragging');
            draggedIndex = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            clearIndicators();
            const rect = e.currentTarget.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;
            e.currentTarget.classList.toggle('drop-indicator-bottom', isAfter);
            e.currentTarget.classList.toggle('drop-indicator-top', !isAfter);
        });

        item.addEventListener('dragleave', (e) => {
             // Only clear if we are moving to an element outside the page list
            if (!pageList.contains(e.relatedTarget)) {
                clearIndicators();
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            let targetIndex = parseInt(e.currentTarget.dataset.index, 10);
            const rect = e.currentTarget.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;

            clearIndicators();

            if (draggedIndex === null || draggedIndex === targetIndex) return;

            // If dropping in the bottom half of an item, the new index is after it
            if (isAfter) {
                targetIndex++;
            }
            // Adjust index if moving an item downwards
            if (draggedIndex < targetIndex) {
                targetIndex--;
            }

            movePage(draggedIndex, targetIndex);
        });
    });
}

// --- Deletion Handling ---

function deletePage(index) {
    if (index < 0 || index >= pages.length) return false;
    const pageName = pages[index].name;
    const confirmed = window.confirm(`Are you sure you want to delete the page "${pageName}"?`);
    if (confirmed) {
        pages.splice(index, 1);
        if (currentPageIndex === index) {
            switchPage(Math.max(0, index - 1));
        } else if (currentPageIndex > index) {
            switchPage(currentPageIndex - 1);
        } else {
            renderPageList();
        }
        return true;
    }
    return false;
}

function handleDeleteKey(event) {
    if (event.key !== 'Delete' || currentPageIndex < 0) return;

    // If a selection exists, delete the selected paths
    if (selectionMin < selectionMax) {
        const confirmed = window.confirm(`Are you sure you want to delete ${selectionMax - selectionMin} selected path(s)?`);
        if (confirmed) {
            const page = pages[currentPageIndex];
            const deleteCount = selectionMax - selectionMin;
            page.data.splice(selectionMin, deleteCount);

            selectionMax = selectionMin; // Reset selection

            if (page.data.length === 0) {
                // If all paths are gone, try to delete the page, but if the user
                // cancels, we must still refresh the canvas to show it's empty.
                if (!deletePage(currentPageIndex)) {
                    updateThumbs();
                    drawCurrentPage();
                }
            } else {
                updateThumbs();
                drawCurrentPage();
            }
        }
    }
    // If no selection exists, delete the entire page
    else {
        deletePage(currentPageIndex);
    }
}

window.addEventListener('keydown', handleDeleteKey);

// --- Printing ---

function printAllPages() {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const printDoc = iframe.contentWindow.document;
    printDoc.write(`<!DOCTYPE html><html><head><title>Print</title><style>
        @page { size: A4 portrait; margin: 0; }
        body { margin: 0; }
        .page-container { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
        .page-container:last-child { page-break-after: avoid; }
        canvas { width: 100%; height: 100%; }
    </style></head><body></body></html>`);
    const printBody = printDoc.body;
    pages.forEach(page => {
        const pageContainer = printDoc.createElement('div');
        pageContainer.className = 'page-container';
        const printCanvas = printDoc.createElement('canvas');
        const printCtx = printCanvas.getContext('2d');
        const printWidth = 2480;
        const printHeight = 3508;
        printCanvas.width = printWidth;
        printCanvas.height = printHeight;
        printCtx.fillStyle = 'white';
        printCtx.fillRect(0, 0, printWidth, printHeight);
        const contentScale = printWidth / 8800;
        printCtx.scale(contentScale, contentScale);
        printCtx.lineWidth = 5;
        printCtx.strokeStyle = 'black';
        page.data.forEach(path => {
            if (path.length > 0) {
                printCtx.beginPath();
                printCtx.moveTo(path[0].x, path[0].y);
                for (let j = 1; j < path.length; j++) {
                    printCtx.lineTo(path[j].x, path[j].y);
                }
                printCtx.stroke();
            }
        });
        pageContainer.appendChild(printCanvas);
        printBody.appendChild(pageContainer);
    });
    printDoc.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 500);
}

window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        printAllPages();
    } else if (e.key === 'F2' && currentPageIndex !== -1) {
        e.preventDefault();
        startRenaming(currentPageIndex);
    }
});

function startRenaming(index) {
    closeContextMenu();
    const listItem = pageList.querySelector(`li[data-index='${index}']`);
    if (!listItem) return;

    const pageNameSpan = listItem.querySelector('.page-name');
    const oldName = pages[index].name;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'page-name-input'; // For potential styling
    input.style.width = '100%'; // Ensure it fills the space
    input.addEventListener('blur', finishRenaming);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur(); // Trigger blur to save
        } else if (e.key === 'Escape') {
            // Restore old name and blur
            input.value = oldName;
            input.blur();
        }
    });

    function finishRenaming() {
        // Clean up listeners
        input.removeEventListener('blur', finishRenaming);

        const newName = input.value.trim();
        if (newName && newName !== oldName) {
            pages[index].name = newName;
        }

        // Re-render the single item to restore the span
        renderPageList(); // Simplest way to refresh the view
    }

    pageNameSpan.replaceWith(input);
    input.focus();
    input.select();
}


// Initial setup
resizeCanvas();
canvasContainer.style.cursor = 'grab';