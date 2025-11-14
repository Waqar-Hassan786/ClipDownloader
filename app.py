from flask import Flask, request, jsonify, render_template, send_file
import yt_dlp
import os
import uuid
import time
import logging
from datetime import datetime
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("clipdownloader.log"),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['DOWNLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')

# Create downloads directory if it doesn't exist
if not os.path.exists(app.config['DOWNLOAD_FOLDER']):
    os.makedirs(app.config['DOWNLOAD_FOLDER'])

# Dictionary to store download progress data
download_progress = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/download', methods=['POST'])
def download():
    try:
        data = request.json
        service = data.get('service', 'youtube')
        url = data.get('url', '')
        download_type = data.get('downloadType', 'default')
        start_time = data.get('startTime', '')
        end_time = data.get('endTime', '')

        if not url:
            return jsonify({'status': 'error', 'message': 'URL is required'}), 400

        # Generate a unique identifier for this download
        download_id = str(uuid.uuid4())
        download_progress[download_id] = {
            'status': 'preparing',
            'progress': 0,
            'filename': '',
            'error': None
        }

        # Start the download process in a separate thread
        from threading import Thread
        thread = Thread(target=process_download, args=(download_id, service, url, download_type, start_time, end_time))
        thread.daemon = True
        thread.start()

        return jsonify({
            'status': 'processing',
            'message': 'Download initiated',
            'download_id': download_id
        })

    except Exception as e:
        logger.error(f"Error in download endpoint: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

def process_download(download_id, service, url, download_type, start_time, end_time):
    try:
        download_progress[download_id]['status'] = 'downloading'
        download_dir = os.path.join(app.config['DOWNLOAD_FOLDER'], download_id)
        os.makedirs(download_dir, exist_ok=True)

        options = get_ydl_options(download_id, download_dir, download_type, start_time, end_time)

        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])

        files = os.listdir(download_dir)
        if files:
            download_progress[download_id]['filename'] = files[0]
            download_progress[download_id]['status'] = 'completed'
        else:
            raise Exception("No file was downloaded")

    except Exception as e:
        logger.error(f"Error during download process for {download_id}: {str(e)}")
        download_progress[download_id]['status'] = 'error'
        download_progress[download_id]['error'] = str(e)

def get_ydl_options(download_id, download_dir, download_type, start_time, end_time):
    options = {
        'format': 'best',
        'outtmpl': os.path.join(download_dir, '%(title)s.%(ext)s'),
        'progress_hooks': [lambda d: update_progress(download_id, d)],
        'noplaylist': True,
        'ffmpeg_location': r'C:\Users\DELL\Desktop\portfolio\files (29)\DOWNLOAD_FOLDER\ffmpeg.exe',
    }

    if 'audio' in download_type:
        options['format'] = 'bestaudio/best'
        options['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }]

    if 'clip' in download_type and start_time:
        if not (re.match(r'^\d{1,2}:\d{1,2}:\d{1,2}$', start_time) or re.match(r'^\d{1,2}:\d{1,2}$', start_time)):
            raise ValueError("Invalid time format. Use HH:MM:SS or MM:SS.")
        
        if len(start_time.split(':')) == 2:
            start_time = f"00:{start_time}"

        options['download_ranges'] = download_range_func(start_time, end_time)
        options['force_keyframes_at_cuts'] = True

    return options

def download_range_func(start_time, end_time):
    start_seconds = time_to_seconds(start_time)
    end_seconds = time_to_seconds(end_time)

    def download_range(info_dict, ydl=None):
        duration = info_dict.get('duration')
        if start_seconds is not None:
            range_end = end_seconds if end_seconds is not None else duration
            if range_end and start_seconds < range_end:
                return [{'start_time': start_seconds, 'end_time': range_end}]
        return None
    return download_range

def time_to_seconds(time_str):
    if not time_str:
        return None
    parts = list(map(int, time_str.split(':')))
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return None

def update_progress(download_id, d):
    if d['status'] == 'downloading':
        total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate')
        if total_bytes:
            progress = (d.get('downloaded_bytes', 0) / total_bytes) * 100
            download_progress[download_id]['progress'] = progress
    elif d['status'] == 'finished':
        download_progress[download_id]['status'] = 'processing'
        # Filename is set after download completes


@app.route('/progress/<download_id>', methods=['GET'])
def get_progress(download_id):
    """Get the progress of a download"""
    if download_id in download_progress:
        return jsonify(download_progress[download_id])
    return jsonify({'status': 'not_found'}), 404

@app.route('/downloads/<download_id>', methods=['GET'])
def get_download(download_id):
    """Get the downloaded file"""
    if download_id in download_progress and download_progress[download_id]['status'] == 'completed':
        download_dir = os.path.join(app.config['DOWNLOAD_FOLDER'], download_id)
        filename = download_progress[download_id]['filename']
        file_path = os.path.join(download_dir, filename)
        
        if os.path.exists(file_path):
            return send_file(file_path, as_attachment=True)
    
    return jsonify({'status': 'error', 'message': 'File not found or download not complete'}), 404

@app.route('/cleanup', methods=['POST'])
def cleanup_old_downloads():
    """Cleanup downloads older than 1 hour"""
    try:
        current_time = time.time()
        removed = 0
        
        for dir_name in os.listdir(app.config['DOWNLOAD_FOLDER']):
            dir_path = os.path.join(app.config['DOWNLOAD_FOLDER'], dir_name)
            if os.path.isdir(dir_path):
                # Check if directory is older than 1 hour
                if current_time - os.path.getmtime(dir_path) > 3600:
                    for file in os.listdir(dir_path):
                        os.remove(os.path.join(dir_path, file))
                    os.rmdir(dir_path)
                    removed += 1
                    
                    # Remove from progress tracking
                    if dir_name in download_progress:
                        del download_progress[dir_name]
        
        return jsonify({'status': 'success', 'removed': removed})
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)