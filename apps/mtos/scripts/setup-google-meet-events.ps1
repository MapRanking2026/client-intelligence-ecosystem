param(
  [Parameter(Mandatory=$true)][string]$ProjectId,
  [string]$Origin = 'https://mtos.mapranking.com'
)
$ErrorActionPreference = 'Stop'
if ($ProjectId -notmatch '^[a-z][a-z0-9-]+$') { throw 'Invalid Google Cloud project ID.' }
if ($Origin -notmatch '^https://[a-zA-Z0-9.-]+$') { throw 'Use the HTTPS production origin without a trailing slash.' }
$gcloud = 'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
function Invoke-Cloud {
  param([string[]]$Arguments)
  $output = & $gcloud @Arguments --project=$ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed: $($Arguments[0..1] -join ' ')" }
  return $output
}
$billing = (Invoke-Cloud @('billing','projects','describe',$ProjectId,'--format=json')) | ConvertFrom-Json
if (-not $billing.billingEnabled) { throw 'Existing billing must be enabled. This script will not link or create a billing account.' }
$project = (Invoke-Cloud @('projects','describe',$ProjectId,'--format=json')) | ConvertFrom-Json
Invoke-Cloud @('services','enable','pubsub.googleapis.com','workspaceevents.googleapis.com','meet.googleapis.com','calendar-json.googleapis.com','drive.googleapis.com') | Out-Null
$topicId = 'mtos-meet-events'
$subscriptionId = 'mtos-meet-events-push'
$accountId = 'mtos-meet-push'
$email = "$accountId@$ProjectId.iam.gserviceaccount.com"
$topic = "projects/$ProjectId/topics/$topicId"
$endpoint = "$Origin/api/integrations/google-meet/events/push"
& $gcloud pubsub topics describe $topic --project=$ProjectId --quiet 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Cloud @('pubsub','topics','create',$topicId) | Out-Null }
Invoke-Cloud @('pubsub','topics','add-iam-policy-binding',$topic,'--member=serviceAccount:meet-api-event-push@system.gserviceaccount.com','--role=roles/pubsub.publisher') | Out-Null
& $gcloud iam service-accounts describe $email --project=$ProjectId --quiet 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Cloud @('iam','service-accounts','create',$accountId,'--display-name=MTOS Meet push identity') | Out-Null }
$agent = "service-$($project.projectNumber)@gcp-sa-pubsub.iam.gserviceaccount.com"
Invoke-Cloud @('iam','service-accounts','add-iam-policy-binding',$email,"--member=serviceAccount:$agent",'--role=roles/iam.serviceAccountTokenCreator') | Out-Null
$caller = (& $gcloud auth list '--filter=status:ACTIVE' '--format=value(account)' --quiet | Select-Object -First 1)
if (-not $caller -or $caller -notmatch '@') { throw 'Sign in with the Google Cloud account that manages this project.' }
$principal = if ($caller.EndsWith('.gserviceaccount.com')) { "serviceAccount:$caller" } else { "user:$caller" }
Invoke-Cloud @('iam','service-accounts','add-iam-policy-binding',$email,"--member=$principal",'--role=roles/iam.serviceAccountUser') | Out-Null
& $gcloud pubsub subscriptions describe $subscriptionId --project=$ProjectId --quiet 2>$null | Out-Null
$action = if ($LASTEXITCODE -eq 0) { 'update' } else { 'create' }
$arguments = @('pubsub','subscriptions',$action,$subscriptionId,"--push-endpoint=$endpoint","--push-auth-service-account=$email","--push-auth-token-audience=$endpoint",'--ack-deadline=600','--min-retry-delay=30s','--max-retry-delay=600s','--message-retention-duration=7d')
if ($action -eq 'create') { $arguments += "--topic=$topic" }
Invoke-Cloud $arguments | Out-Null
[ordered]@{
  GOOGLE_MEET_EVENTS_TOPIC = $topic
  GOOGLE_MEET_EVENTS_AUDIENCE = $endpoint
  GOOGLE_MEET_EVENTS_PUSH_EMAIL = $email
  GOOGLE_MEET_EVENTS_PUSH_SUBSCRIPTION = "projects/$ProjectId/subscriptions/$subscriptionId"
} | ConvertTo-Json
