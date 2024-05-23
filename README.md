# trimrr

## Overview

**trimrr** is a script designed to manage and clean up TV shows from your Emby server based on their watch status and ratings from Trakt. It integrates with Sonarr for deletion of shows, allowing you to maintain a clean and efficient media library. 

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

```sh
node src/index.mjs
```

## Workflow

1. Fetching Users and Shows:

- The script fetches all users and shows from your Emby server.

2. Calculating Play Counts:

- It checks the play state of each show for each user.

3. Fetching Trakt Ratings:

- For shows with no plays, it fetches their ratings from Trakt.

4. Show Deletion:

- Based on the rating threshold and play state, it prompts whether to delete the shows from Sonarr.
- You can choose to delete all recommended shows at once or decide for each show individually.

## Logging

- Logs are stored in the logs directory with the filename trimrr.log.
- The log file includes detailed information about the script's operations, including errors and successful API calls.

## Example Workflow

```sh
2024-05-22T17:24:47.478Z [INFO] Fetching users...
2024-05-22T17:24:47.478Z [INFO] Users fetched: 27
2024-05-22T17:24:47.478Z [INFO] Fetching shows...
2024-05-22T17:24:47.478Z [INFO] Shows fetched: 846
2024-05-22T17:24:47.478Z [INFO] Calculating play counts...
2024-05-22T17:24:47.478Z [INFO] Checking play state for shows...
2024-05-22T17:24:47.478Z [INFO] Shows with no plays found: 533
2024-05-22T17:24:47.478Z [INFO] Fetching Trakt ratings for shows with no plays...
2024-05-22T17:24:47.478Z [INFO] Trakt rating for Show A: 5.42
2024-05-22T17:24:47.478Z [INFO] Trakt rating for Show B: 6.84
2024-05-22T17:24:47.478Z [INFO] Shows with rating lower than threshold:
2024-05-22T17:24:47.478Z [INFO] Show A (Rating: 5.42, Size: 43.2 GB)
Would you like to delete all recommended shows? (Yes/No/Cancel): n
Delete "Show A" (Rating: 5.42, Size: 43.2 GB)? (Yes/No/Cancel): y
2024-05-22T17:24:47.478Z [INFO] Series with ID 527 successfully deleted from Sonarr.
2024-05-22T17:24:47.478Z [INFO] Process completed.
Statistics:
- Total shows detected: 846
- Shows recommended for deletion: 41
- Total size of recommended deletions: 1.79 GB
- Total size of actual deletions: 1.43 GB
```
## Notes

This is made with ChatGPT and I have no development experience. Use at your own risk but I use it for my environment and it helps a lot.
