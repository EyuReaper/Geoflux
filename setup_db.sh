#!/bin/bash
# Remove existing container if it exists
sudo docker rm -f geoflux-db 2>/dev/null

# Run the container in a single line to avoid shell issues
sudo docker run -d \
  --name geoflux-db \
  -e POSTGRES_USER=geodude \
  -e POSTGRES_PASSWORD=69concretedatamf \
  -e POSTGRES_DB=geoflux \
  -p 5432:5432 \
  postgis/postgis
