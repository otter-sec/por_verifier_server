FROM ubuntu:latest

# install dependencies using apt
RUN apt-get update && apt-get install -y git curl sudo

# install node from the official release tarball (ubuntu's nodejs package lags behind node security releases)
# to upgrade: bump NODE_VERSION and set NODE_SHA256 to the node-v<version>-linux-x64.tar.gz entry in
# https://nodejs.org/dist/v<version>/SHASUMS256.txt
ARG NODE_VERSION=22.23.4
ARG NODE_SHA256=b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406
RUN curl -fsSLo /tmp/node.tar.gz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
    && echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --no-same-owner \
    && rm /tmp/node.tar.gz \
    && node --version && npm --version

# install rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly
ENV PATH="/root/.cargo/bin:${PATH}"

# add node user
RUN useradd -m node

# add node home to path --> this is where the prover will be installed by the application
ENV PATH="/home/node/:${PATH}"

# copy the server code
COPY . /app

# install dependencies and build
WORKDIR /app
RUN npm install
RUN npm run build

# expose server port
EXPOSE 3000

# run the server
USER node
CMD ["npm", "start"]