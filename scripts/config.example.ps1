# Rename this file to config.ps1
# and replace the placeholder values
# with your actual values.

$config = @{
  'gmail-push-proxy' = @{                                     # Cloud Run service name
    projectId                 = "YOUR_PROJECT_ID"                   # GCP project ID where the Cloud Run service will be deployed
    region                    = "YOUR_CLOUD_RUN_REGION"                 # The Cloud Run deployment region
    baseImage                 = "nodejs22"                    # Base image runtime for the Cloud Run service (e.g., nodejs, python, etc.)
    functionEntrypoint        = "pushProxy"                   # The name of the exported function in your source code (e.g., index.js)
    serviceAccountName        = "YOUR_SERVICE_ACCOUNT_NAME"         # Name used when creating the service account for the Cloud Run service
    pubsubTopic               = "YOUR_PUBSUB_TOPIC_NAME"     # Name of the Pub/Sub topic that triggers the service
    artifactRegistryRepo      = "cloud-run-source-deploy"     # Name of the Artifact Registry repository for Cloud Run source builds
    artifactRegistryLocation  = "YOUR_CLOUD_RUN_REGION"                 # Location of the Artifact Registry (often same as the Cloud Run region)
  }
}

