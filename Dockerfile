FROM ubuntu:latest

# install dependencies using apt
RUN apt-get update && apt-get install -y nodejs npm git curl sudo

# install rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly
ENV PATH="/root/.cargo/bin:${PATH}"

# install prover using update-prover.sh
COPY scripts/update-prover.sh /update-prover.sh

# make the script executable and run it to compile the prover
RUN chmod +x /update-prover.sh && \
    /update-prover.sh


# add the update-prover.sh to the sudoers file
RUN echo "node ALL=(root) NOPASSWD: /update-prover.sh" >> /etc/sudoers

# add node user
RUN useradd -m node

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