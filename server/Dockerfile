FROM rocker/r-ver:4.4.2

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install TeXLive and Pandoc + Dutch language support + System dependencies for R packages
RUN apt-get update && apt-get install -y \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-science \
    texlive-xetex \
    texlive-luatex \
    texlive-lang-european \
    latexmk \
    biber \
    xz-utils \
    pandoc \
    fontconfig \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    libnlopt-dev \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Install Typst
RUN curl -L https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | tar -xJ && \
    mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/ && \
    rm -rf typst-x86_64-unknown-linux-musl

WORKDIR /app
COPY package*.json ./
RUN npm install

# Copy custom fonts and update cache
COPY fonts/ /usr/share/fonts/dm-sans/
RUN fc-cache -f -v

COPY . .
RUN npm run build

EXPOSE 3001
CMD ["npm", "start"]
