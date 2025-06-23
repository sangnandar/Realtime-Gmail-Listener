# --- Configuration Variables ---
. "$PSScriptRoot\config.ps1"

# Ensure this is the Cloud Run service you want to teardown
$cloudRunService = "gmail-push-proxy"

# Get service's variables from config
$props = @(
  "projectId",
  "region",
  "baseImage",
  "functionEntrypoint",
  "serviceAccountName",
  "pubsubTopic",
  "artifactRegistryRepo",
  "artifactRegistryLocation"
)
foreach ($prop in $props) {
  Set-Variable -Name $prop -Value $config[$cloudRunService][$prop]
}

$serviceAccountEmail = "$serviceAccountName@$projectId.iam.gserviceaccount.com"



Write-Host "Teardown started..."

# --- 1. Delete Eventarc Trigger ---
Write-Host "`n--- Step 1: Deleting Eventarc Trigger ---"
Write-Host "Deleting Eventarc trigger 'gmail-listener-to-$cloudRunService-trigger' in location '$region'..."
gcloud eventarc triggers delete "gmail-listener-to-$cloudRunService-trigger" `
    --location=$region `
    --quiet

# --- 2. Delete Cloud Run Service ---
Write-Host "`n--- Step 2: Deleting Cloud Run Service ---"
Write-Host "Deleting Cloud Run service '$cloudRunService' in region '$region'..."
gcloud run services delete $cloudRunService `
    --region=$region `
    --quiet

# --- 3. Remove IAM Bindings from Project ---
# Note: It's good practice to remove permissions before deleting the principal (the service account).
Write-Host "`n--- Step 3: Removing IAM Policy Bindings from Project ---"

Write-Host "Removing 'roles/secretmanager.secretAccessor' from '$serviceAccountEmail'..."
gcloud projects remove-iam-policy-binding $projectId `
    --member="serviceAccount:$serviceAccountEmail" `
    --role="roles/secretmanager.secretAccessor" `
    --quiet 2>$null

Write-Host "Removing 'roles/eventarc.eventReceiver' from '$serviceAccountEmail'..."
gcloud projects remove-iam-policy-binding $projectId `
    --member="serviceAccount:$serviceAccountEmail" `
    --role="roles/eventarc.eventReceiver" `
    --quiet 2>$null

# The 'run.invoker' role was service-specific and is deleted with the service.

# --- 4. Delete Service Account ---
Write-Host "`n--- Step 4: Deleting Service Account ---"
Write-Host "Deleting service account '$serviceAccountName'..."
gcloud iam service-accounts delete $serviceAccountEmail `
    --quiet

# --- 5. Delete Pub/Sub Topic ---
Write-Host "`n--- Step 5: Deleting Pub/Sub Topic ---"

# First, remove the specific IAM policy binding for the Gmail service account.
Write-Host "Removing Gmail API push access from topic '$pubsubTopic'..."
gcloud pubsub topics remove-iam-policy-binding $pubsubTopic `
    --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" `
    --role="roles/pubsub.publisher" `
    --quiet 2>$null

Write-Host "Deleting Pub/Sub topic '$pubsubTopic'..."
gcloud pubsub topics delete $pubsubTopic `
    --quiet

# --- 6. Delete Artifact Registry Repository ---
Write-Host "`n--- Step 6: Deleting Artifact Registry Repository ---"
Write-Host "Deleting Artifact Registry repository '$artifactRegistryRepo' in '$artifactRegistryLocation'..."
$fullRepoPath = "$artifactRegistryLocation-docker.pkg.dev/$projectId/$artifactRegistryRepo/$cloudRunService"

# Get package + version, of images
$imageRefs = gcloud artifacts docker images list $fullRepoPath --format="value(PACKAGE, VERSION)" `
    | ForEach-Object {
        $parts = $_ -split "\s+"
        if ($parts.Length -eq 2) {
            $package = $parts[0]
            $version = $parts[1]
            if ($version.StartsWith("sha256:")) {
            "${package}@${version}"
            } else {
            "${package}:${version}"
            }
        }
    }

# Delete images
$imageRefs | ForEach-Object {
    gcloud artifacts docker images delete $_ --quiet --delete-tags
}

# Delete the package itself
gcloud artifacts packages delete $cloudRunService `
    --location=$artifactRegistryLocation `
    --repository=$artifactRegistryRepo `
    --quiet

# --- 7. Delete GCS Bucket for Cloud Build Artifacts ---
Write-Host "`n--- Step 7: Deleting GCS Bucket ---"
# The following command removes all files and versions within the bucket recursively.
# This bucket is auto-created by Cloud Build for staging source code.
# Note: If you configured a different bucket for builds, you must change the name here.
$bucketName = "gs://run-sources-${projectId}-${region}/services/${cloudRunService}"
Write-Host "Deleting GCS bucket '$bucketName' and all its contents..."
gcloud storage rm --recursive $bucketName | Out-Null 2>$null

# Note: Disabling APIs is generally not recommended as it can affect other
# deployments. They can be left enabled without incurring costs.

Write-Host "`nTeardown finished."
