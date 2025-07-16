FROM ubuntu:latest

# install dependencies using apt
RUN apt-get update && apt-get install -y nodejs npm git curl sudo

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

# create database directory and set permissions
RUN mkdir -p /db && chown -R node:node /db

# expose server port
EXPOSE 3000

# run the server
USER node
CMD ["npm", "start"]