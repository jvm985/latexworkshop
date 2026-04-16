FROM node:20-bookworm

# Install TeXLive 2022+ and compilers + Pandoc + Dutch language support + R
# Bookworm includes newer tabularray package in texlive-latex-extra
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
    curl \
    xz-utils \
    pandoc \
    fontconfig \
    r-base \
    && rm -rf /var/lib/apt/lists/*

# Install system dependencies for common R packages
RUN apt-get update && apt-get install -y \
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

# Install essential R packages for rmarkdown and jsonlite
RUN R -e "install.packages(c('jsonlite', 'rmarkdown', 'knitr', 'tinytex'), repos='https://cloud.r-project.org')"

# Install plotting and data packages
RUN R -e "install.packages(c('ggplot2', 'dplyr', 'readr', 'readxl', 'lubridate', 'stringr', 'purrr', 'data.table'), repos='https://cloud.r-project.org')"

# Install additional analysis packages
RUN R -e "install.packages(c('caret', 'randomForest', 'plotly', 'RColorBrewer', 'reshape2', 'zoo', 'xts', 'forecast'), repos='https://cloud.r-project.org')"

# Install more utilities
RUN R -e "install.packages(c('lme4', 'mgcv', 'survival', 'MASS', 'stringi', 'magrittr', 'DBI', 'RSQLite', 'httr', 'xml2', 'rvest'), repos='https://cloud.r-project.org')"

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
