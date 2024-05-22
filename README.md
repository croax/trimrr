# trimrr

## Overview

**trimrr** is a script designed to manage and clean up TV shows from your Emby server based on their watch status and ratings from Trakt. It integrates with Sonarr for deletion of shows, allowing you to maintain a clean and efficient media library. The script is modular, making it easy to extend support for additional services like Plex and Radarr in the future.

## Features

- Fetches user and show data from Emby
- Retrieves ratings from Trakt
- Checks play state of shows on Emby
- Deletes shows from Sonarr based on ratings and play state
- Logs all operations with detailed timestamps
- Modular design for easy extension

## Setup

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Clone the repository:

    ```sh
    git clone https://github.com/yourusername/trimrr.git
    cd trimrr
    ```

2. Install the required dependencies:

    ```sh
    npm install
    ```

3. Create a `.env` file in the root directory of the project and add your configuration variables:

    ```env
    EMBY_API_KEY=your_emby_api_key
    EMBY_SERVER_URL=http://your_emby_server_url
    TRAKT_CLIENT_ID=your_trakt_client_id
    SONARR_API_KEY=your_sonarr_api_key
    SONARR_SERVER_URL=http://your_sonarr_server_url
    RATING_THRESHOLD=6
    ```

4. Ensure the logs directory exists:

    ```sh
    mkdir -p logs
    ```

### Configuration

- **EMBY_API_KEY**: Your Emby server API key.
- **EMBY_SERVER_URL**: The URL to your Emby server.
- **TRAKT_CLIENT_ID**: Your Trakt API client ID.
- **SONARR_API_KEY**: Your Sonarr server API key.
- **SONARR_SERVER_URL**: The URL to your Sonarr server.
- **RATING_THRESHOLD**: The rating threshold below which shows will be considered for deletion.

## Usage

### Running the Script

To run the script, execute the following command:

node src/index.mjs

Workflow
Fetching Users and Shows:

The script fetches all users and shows from your Emby server.
Calculating Play Counts:

It checks the play state of each show for each user.
Fetching Trakt Ratings:

For shows with no plays, it fetches their ratings from Trakt.
Show Deletion:

Based on the rating threshold and play state, it prompts whether to delete the shows from Sonarr.
You can choose to delete all recommended shows at once or decide for each show individually.

