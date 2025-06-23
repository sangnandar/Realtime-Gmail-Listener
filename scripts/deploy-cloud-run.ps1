# --- Configuration Variables ---
. "$PSScriptRoot\config.ps1"

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

$rootPath = (Resolve-Path "$PSScriptRoot\..\src\cloud_run").Path # Ensure $rootPath is a string for source



Write-Host "Deployment started..."
Write-Host "Running in idempotent mode (will check for existing resources before creating)."

# --- 0. Enable APIs ---
Write-Host "`n--- Step 0: Enable Required APIs ---"
$requiredApis = @(
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com"
)
$enabledApis = gcloud services list --enabled --format="value(config.name)"
foreach ($api in $requiredApis) {
    if ($enabledApis -notcontains $api) {
        Write-Host "Enabling $api..."
        gcloud services enable $api | Out-Null
    } else {
        Write-Host "API '$api' is already enabled."
    }
}

# --- 1. Artifact Registry Setup ---
# This step is optional — the "cloud-run-source-deploy" repository is automatically created 
# when you deploy a Cloud Run service using the --source flag.
Write-Host "`n--- Step 1: Artifact Registry Setup ---"
gcloud artifacts repositories describe $artifactRegistryRepo --location=$artifactRegistryLocation --quiet | Out-Null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Artifact Registry repository '$artifactRegistryRepo' in '$artifactRegistryLocation'..."
    gcloud artifacts repositories create $artifactRegistryRepo `
        --repository-format=docker `
        --location=$artifactRegistryLocation `
        --description="Docker repository for Cloud Run source deployments" | Out-Null
} else {
    Write-Host "Artifact Registry repository '$artifactRegistryRepo' already exists."
}

# --- 2. Pub/Sub Topic Setup ---
Write-Host "`n--- Step 2: Pub/Sub Topic Setup ---"
gcloud pubsub topics describe $pubsubTopic --quiet | Out-Null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Pub/Sub topic '$pubsubTopic'..."
    gcloud pubsub topics create $pubsubTopic | Out-Null
} else {
    Write-Host "Pub/Sub topic '$pubsubTopic' already exists."
}

# Grant Gmail API push access to the topic
$member = "serviceAccount:gmail-api-push@system.gserviceaccount.com"
$role = "roles/pubsub.publisher"
$policy = gcloud pubsub topics get-iam-policy $pubsubTopic --format=json | ConvertFrom-Json
$bindingExists = $policy.bindings | Where-Object { $_.role -eq $role -and $_.members -contains $member }
if (-not $bindingExists) {
    Write-Host "Granting '$role' to '$member' on topic '$pubsubTopic'..."
    gcloud pubsub topics add-iam-policy-binding $pubsubTopic `
        --member=$member `
        --role=$role | Out-Null
} else {
    Write-Host "Role '$role' is already granted to '$member' on topic '$pubsubTopic'."
}

# --- 3. Service Account Setup ---
Write-Host "`n--- Step 3: Service Account Setup ---"
gcloud iam service-accounts describe $serviceAccountEmail --quiet | Out-Null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating service account '$serviceAccountName'..."
    gcloud iam service-accounts create $serviceAccountName `
        --display-name="Service Account for Cloud Run and Eventarc" | Out-Null
} else {
    Write-Host "Service account '$serviceAccountName' already exists."
}

# Grant necessary project-level roles to the service account
$projectPolicy = gcloud projects get-iam-policy $projectId --format=json | ConvertFrom-Json
$saMember = "serviceAccount:$serviceAccountEmail"
$rolesToGrant = @("roles/secretmanager.secretAccessor", "roles/eventarc.eventReceiver")

foreach ($role in $rolesToGrant) {
    $bindingExists = $projectPolicy.bindings | Where-Object { $_.role -eq $role -and $_.members -contains $saMember }
    if (-not $bindingExists) {
        Write-Host "Granting '$role' to '$serviceAccountEmail' on project '$projectId'..."
        gcloud projects add-iam-policy-binding $projectId `
            --member=$saMember `
            --role=$role | Out-Null
    } else {
        Write-Host "Role '$role' is already granted to '$serviceAccountEmail' on project '$projectId'."
    }
}

# --- 4. Cloud Run Service Deployment ---
# gcloud run deploy handles updates automatically, making it an "upsert" operation.
# It will only create a new revision if the source code or configuration has changed.
# This command is naturally idempotent.
Write-Host "`n--- Step 4: Cloud Run Service Deployment ---"
Write-Host "Deploying/updating Cloud Run service '$cloudRunService' in region '$region'."
gcloud run deploy $cloudRunService `
    --region=$region `
    --source=$rootPath `
    --function=$functionEntrypoint `
    --base-image=$baseImage `
    --service-account=$serviceAccountEmail `
    --set-secrets="GAS_API_URL=PUSH_PROXY_GAS_API_URL:latest,GAS_API_KEY=PUSH_PROXY_GAS_API_KEY:latest" `
    --quiet

# Grant run.invoker role to the service account for the service
$runPolicy = gcloud run services get-iam-policy $cloudRunService --region $region --format=json | ConvertFrom-Json
$runInvokerRole = "roles/run.invoker"
$bindingExists = $runPolicy.bindings | Where-Object { $_.role -eq $runInvokerRole -and $_.members -contains $saMember }
if (-not $bindingExists) {
    Write-Host "Granting 'roles/run.invoker' to '$serviceAccountEmail' for service '$cloudRunService'..."
    gcloud run services add-iam-policy-binding $cloudRunService `
        --member=$saMember `
        --role=$runInvokerRole `
        --region=$region | Out-Null
} else {
    Write-Host "Role 'roles/run.invoker' is already granted to '$serviceAccountEmail' on service '$cloudRunService'."
}

# --- 5. Eventarc Trigger Creation ---
Write-Host "`n--- Step 5: Eventarc Trigger Creation ---"
$triggerName = "gmail-listener-to-$cloudRunService-trigger"
gcloud eventarc triggers describe $triggerName --location=$region --quiet | Out-Null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Eventarc trigger '$triggerName'..."
    gcloud eventarc triggers create $triggerName `
        --destination-run-service=$cloudRunService `
        --destination-run-region=$region `
        --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" `
        --transport-topic=$pubsubTopic `
        --service-account=$serviceAccountEmail `
        --location=$region `
        --quiet | Out-Null
} else {
    Write-Host "Eventarc trigger '$triggerName' already exists."
}

Write-Host "`nDeployment finished."
