document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selections ---
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('video-url');
    const pasteButton = document.getElementById('paste-button');
    const optionCards = document.querySelectorAll('.iron-card');
    const downloadTypeInputs = document.querySelectorAll('input[name="download-type"]');
    const timestampSection = document.getElementById('timestamp-section');
    const statusArea = document.getElementById('status-area');
    const serviceTabs = document.querySelectorAll('.iron-tab');
    const downloadButton = document.getElementById('download-button');
    const youtubeOptions = document.getElementById('youtube-options');

    let currentService = 'youtube'; // Default service
    let selectedDownloadType = null;
    let currentDownloadId = null;
    let progressInterval = null;

    // --- Event Listeners ---

    // 1. Service Tab Click Handler
    serviceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab UI
            serviceTabs.forEach(t => t.classList.remove('active-tab'));
            tab.classList.add('active-tab');
            
            // Update current service and UI elements
            currentService = tab.dataset.service;
            updateUIForService(currentService);
        });
    });

    // 2. Download Type Option Card Click Handler
    optionCards.forEach(card => {
        card.addEventListener('click', () => {
            // Uncheck all and remove selected class
            optionCards.forEach(c => c.classList.remove('selected'));
            
            // Check the radio button inside the clicked card and add selected class
            const radio = card.querySelector('input[type="radio"]');
            radio.checked = true;
            card.classList.add('selected');
            
            selectedDownloadType = radio.value;

            // Show/hide timestamp section based on selection
            toggleTimestampSection(selectedDownloadType);
        });
    });

    // 3. Paste Button Functionality
    pasteButton.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            showStatus('URL SUCCESSFULLY PASTED', 'success');
        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
            showStatus('CLIPBOARD ACCESS DENIED', 'error');
        }
    });

    // 4. Form Submission Handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent actual form submission
        
        const url = urlInput.value.trim();
        if (!url) {
            showStatus('URL INPUT REQUIRED', 'error');
            return;
        }

        if (currentService === 'youtube' && !selectedDownloadType) {
            showStatus('SELECT EXTRACTION MODE', 'error');
            return;
        }

        // Collect all data
        const downloadData = {
            service: currentService,
            url: url,
            downloadType: currentService === 'youtube' ? selectedDownloadType : 'default',
            startTime: document.getElementById('start-time')?.value.trim() || '',
            endTime: document.getElementById('end-time')?.value.trim() || ''
        };

        // Set download in progress state
        setDownloadInProgress(true);
        showStatus(`INITIALIZING ${currentService.toUpperCase()} EXTRACTION...`, 'info');

        try {
            // Send the download request to the backend
            const response = await fetch('/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(downloadData)
            });

            const data = await response.json();
            
            if (data.status === 'processing' && data.download_id) {
                currentDownloadId = data.download_id;
                
                // Start checking the progress
                startProgressCheck(currentDownloadId);
            } else {
                setDownloadInProgress(false);
                showStatus(`ERROR: ${data.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            console.error('Download request failed:', error);
            setDownloadInProgress(false);
            showStatus('SERVER CONNECTION FAILED', 'error');
        }
    });

    // Function to start checking download progress
    function startProgressCheck(downloadId) {
        if (progressInterval) {
            clearInterval(progressInterval);
        }

        progressInterval = setInterval(async () => {
            try {
                const response = await fetch(`/progress/${downloadId}`);
                const progressData = await response.json();
                
                if (progressData.status === 'error') {
                    clearInterval(progressInterval);
                    setDownloadInProgress(false);
                    showStatus(`ERROR: ${progressData.error || 'Download failed'}`, 'error');
                } 
                else if (progressData.status === 'completed') {
                    clearInterval(progressInterval);
                    setDownloadInProgress(false);
                    
                    // Create download link
                    const downloadLink = document.createElement('a');
                    downloadLink.href = `/downloads/${downloadId}`;
                    downloadLink.className = 'iron-button mt-4';
                    downloadLink.innerHTML = '<i class="fas fa-file-download mr-3"></i> DOWNLOAD FILE';
                    downloadLink.target = '_blank';
                    
                    // Show success message with download link
                    showStatus('EXTRACTION COMPLETE', 'success', downloadLink);
                } 
                else {
                    // Update progress bar if we're still downloading
                    const progress = progressData.progress || 0;
                    updateProgressBar(progress);
                }
            } catch (error) {
                console.error('Error checking progress:', error);
            }
        }, 1000); // Check every second
    }

    // Function to update progress bar
    function updateProgressBar(progress) {
        // Either update an existing progress bar or create one
        let progressBar = document.querySelector('.progress-bar');
        
        if (!progressBar) {
            // Create progress bar elements
            const progressContainer = document.createElement('div');
            progressContainer.className = 'progress-container mt-4';
            
            progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            
            const progressText = document.createElement('span');
            progressText.className = 'progress-text';
            
            progressContainer.appendChild(progressBar);
            progressContainer.appendChild(progressText);
            
            // Add to status area
            const statusMessage = document.querySelector('.iron-status');
            if (statusMessage) {
                statusMessage.appendChild(progressContainer);
            }
        }
        
        // Update progress value
        const progressText = document.querySelector('.progress-text');
        progressBar.style.width = `${progress}%`;
        if (progressText) {
            progressText.textContent = `${Math.round(progress)}%`;
        }
    }

    // --- Helper Functions ---

    // Function to show/hide timestamp inputs
    function toggleTimestampSection(type) {
        if (type === 'video-clip' || type === 'audio-clip') {
            timestampSection.classList.add('active');
        } else {
            timestampSection.classList.remove('active');
        }
    }

    // Function to update UI based on selected service
    function updateUIForService(service) {
        // For now, we only have special options for YouTube.
        // For other services, we can hide the options.
        if (service === 'youtube') {
            youtubeOptions.style.display = 'block';
        } else {
            youtubeOptions.style.display = 'none';
            timestampSection.classList.remove('active'); // Hide timestamps too
        }
        // Reset form state
        form.reset();
        optionCards.forEach(c => c.classList.remove('selected'));
        selectedDownloadType = null;
        urlInput.placeholder = `ENTER ${service.toUpperCase()} URL`;
    }

    // Function to display status messages
    function showStatus(message, type = 'info', extraElement = null) {
        statusArea.innerHTML = ''; // Clear previous messages
        const statusMessage = document.createElement('div');
        
        statusMessage.className = `iron-status ${type}`;
        
        let iconClass;
        switch (type) {
            case 'success':
                iconClass = 'fas fa-check-circle';
                break;
            case 'error':
                iconClass = 'fas fa-exclamation-triangle';
                break;
            default: // info
                iconClass = 'fas fa-info-circle';
        }
        
        statusMessage.innerHTML = `<i class="${iconClass} text-2xl mr-4"></i> <span class="text-xl">${message}</span>`;
        
        statusArea.appendChild(statusMessage);
        
        // Add extra element if provided (like a download button)
        if (extraElement) {
            statusArea.appendChild(extraElement);
        }
    }
    
    // Function to manage the download button state
    function setDownloadInProgress(inProgress) {
        const buttonText = downloadButton.querySelector('span');
        const buttonIcon = downloadButton.querySelector('i');

        if (inProgress) {
            downloadButton.disabled = true;
            downloadButton.classList.add('opacity-70', 'cursor-not-allowed');
            buttonIcon.className = 'fas fa-spinner fa-spin mr-4';
            buttonText.textContent = 'PROCESSING';
        } else {
            downloadButton.disabled = false;
            downloadButton.classList.remove('opacity-70', 'cursor-not-allowed');
            buttonIcon.className = 'fas fa-download mr-4';
            buttonText.textContent = 'INITIALIZE DOWNLOAD';
        }
    }
});