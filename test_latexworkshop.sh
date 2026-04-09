#!/bin/bash
URL="https://latexworkshop.irishof.cloud"

echo "🔍 Starting smoke tests for $URL..."

# 1. Frontend Test
echo "Testing Frontend (Nginx & React)..."
HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}\n" "$URL")
if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ Frontend is UP (Status: 200)"
else
    echo "❌ Frontend is DOWN (Status: $HTTP_STATUS)"
    exit 1
fi

# 2. Backend Auth Middleware Test
echo "Testing Backend API Security (Expect 401 Unauthorized for unauthenticated requests)..."
API_STATUS=$(curl -o /dev/null -s -w "%{http_code}\n" "$URL/api/projects")
if [ "$API_STATUS" -eq 401 ]; then
    echo "✅ Backend is UP and Google Auth Middleware is active (Status: 401)"
else
    echo "❌ Backend is NOT returning 401. Security risk! (Status: $API_STATUS)"
    exit 1
fi

echo "✨ Smoke tests geslaagd! Je app is veilig en online."
