# Stage 1: compile the Go program
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
ARG VERSION=v1
RUN CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /whoami .

# Stage 2: ship only the binary (image is a few MB)
FROM scratch
COPY --from=build /whoami /whoami
EXPOSE 8080
ENTRYPOINT ["/whoami"]
